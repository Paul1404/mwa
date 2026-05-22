import { eventIterator, ORPCError, os } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { audit } from "../audit.server";
import { encrypt, fingerprintKey } from "../crypto.server";
import { db, schema } from "../db";
import { runPreflight } from "../preflight.server";
import { executeRun, type RunLogEvent, runBroadcaster, runLock } from "../runner.server";
import { HostKeyMismatchError } from "../ssh.server";
import type { OrpcContext } from "./context.server";

const base = os.$context<OrpcContext>();

const requireAuth = base.middleware(async ({ context, next }) => {
  if (!context.userId) {
    throw new ORPCError("UNAUTHORIZED", { message: "sign in required" });
  }
  return next({ context: { ...context, userId: context.userId } });
});

const authed = base.use(requireAuth);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CredentialIdInput = v.object({ id: v.pipe(v.string(), v.uuid()) });

const CreateCredentialInput = v.object({
  label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  host: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  username: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
  privateKey: v.pipe(
    v.string(),
    v.minLength(50),
    v.check(
      (k) => k.includes("BEGIN") && k.includes("PRIVATE KEY"),
      "must be a PEM-encoded private key",
    ),
  ),
  passphrase: v.optional(v.string()),
});

const UpdateCredentialInput = v.object({
  id: v.pipe(v.string(), v.uuid()),
  label: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))),
  host: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255))),
  port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))),
  username: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))),
  privateKey: v.optional(v.pipe(v.string(), v.minLength(50))),
  passphrase: v.optional(v.string()),
});

const CredentialSummary = v.object({
  id: v.string(),
  label: v.string(),
  host: v.string(),
  port: v.number(),
  username: v.string(),
  publicKeyFingerprint: v.nullable(v.string()),
  hostFingerprint: v.nullable(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const RunSummary = v.object({
  id: v.string(),
  credentialId: v.string(),
  status: v.string(),
  exitCode: v.nullable(v.number()),
  errorMessage: v.nullable(v.string()),
  startedAt: v.string(),
  finishedAt: v.nullable(v.string()),
});

// Event yielded over the streaming run procedure. Wide-open shape so the
// client doesn't need to know the union details statically.
const LogEvent = v.object({
  kind: v.union([v.literal("log"), v.literal("status")]),
  runId: v.string(),
  step: v.optional(v.string()),
  stream: v.optional(v.string()),
  seq: v.optional(v.number()),
  line: v.optional(v.string()),
  at: v.optional(v.string()),
  status: v.optional(v.string()),
  exitCode: v.nullish(v.number()),
  errorMessage: v.nullish(v.string()),
  finishedAt: v.nullish(v.string()),
});

// ---------------------------------------------------------------------------
// Credentials procedures
// ---------------------------------------------------------------------------

function serializeCredential(row: typeof schema.sshCredentials.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    publicKeyFingerprint: row.publicKeyFingerprint,
    hostFingerprint: row.hostFingerprint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listCredentials = authed.output(v.array(CredentialSummary)).handler(async () => {
  const rows = await db
    .select()
    .from(schema.sshCredentials)
    .orderBy(desc(schema.sshCredentials.createdAt));
  return rows.map(serializeCredential);
});

const getCredential = authed
  .input(CredentialIdInput)
  .output(CredentialSummary)
  .handler(async ({ input }) => {
    const row = await db.query.sshCredentials.findFirst({
      where: eq(schema.sshCredentials.id, input.id),
    });
    if (!row) throw new ORPCError("NOT_FOUND", { message: "credential not found" });
    return serializeCredential(row);
  });

const createCredential = authed
  .input(CreateCredentialInput)
  .output(CredentialSummary)
  .handler(async ({ input, context }) => {
    const [row] = await db
      .insert(schema.sshCredentials)
      .values({
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
        privateKeyEnc: encrypt(input.privateKey),
        passphraseEnc: input.passphrase ? encrypt(input.passphrase) : null,
        publicKeyFingerprint: fingerprintKey(input.privateKey),
        createdBy: context.userId!,
      })
      .returning();
    if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
    await audit({
      userId: context.userId,
      action: "credential.create",
      targetType: "credential",
      targetId: row.id,
      metadata: { label: row.label, host: row.host, username: row.username },
      headers: context.headers,
    });
    return serializeCredential(row);
  });

const updateCredential = authed
  .input(UpdateCredentialInput)
  .output(CredentialSummary)
  .handler(async ({ input, context }) => {
    const patch: Partial<typeof schema.sshCredentials.$inferInsert> = {
      updatedAt: new Date(),
    };
    const changed: string[] = [];
    if (input.label !== undefined) {
      patch.label = input.label;
      changed.push("label");
    }
    if (input.host !== undefined) {
      patch.host = input.host;
      // Host changes invalidate the pinned key. Re-pin on next connect.
      patch.hostFingerprint = null;
      changed.push("host");
    }
    if (input.port !== undefined) {
      patch.port = input.port;
      changed.push("port");
    }
    if (input.username !== undefined) {
      patch.username = input.username;
      changed.push("username");
    }
    if (input.privateKey !== undefined) {
      patch.privateKeyEnc = encrypt(input.privateKey);
      patch.publicKeyFingerprint = fingerprintKey(input.privateKey);
      changed.push("privateKey");
    }
    if (input.passphrase !== undefined) {
      patch.passphraseEnc = input.passphrase ? encrypt(input.passphrase) : null;
      changed.push("passphrase");
    }

    const [row] = await db
      .update(schema.sshCredentials)
      .set(patch)
      .where(eq(schema.sshCredentials.id, input.id))
      .returning();
    if (!row) throw new ORPCError("NOT_FOUND", { message: "credential not found" });
    await audit({
      userId: context.userId,
      action: "credential.update",
      targetType: "credential",
      targetId: row.id,
      metadata: { changed },
      headers: context.headers,
    });
    return serializeCredential(row);
  });

const deleteCredential = authed
  .input(CredentialIdInput)
  .output(v.object({ ok: v.literal(true) }))
  .handler(async ({ input, context }) => {
    if (runLock.active()) {
      const active = await db.query.updateRuns.findFirst({
        where: eq(schema.updateRuns.id, runLock.active()!),
      });
      if (active && active.credentialId === input.id) {
        throw new ORPCError("CONFLICT", {
          message: "cannot delete credential while an update is running",
        });
      }
    }
    const existing = await db.query.sshCredentials.findFirst({
      where: eq(schema.sshCredentials.id, input.id),
    });
    await db.delete(schema.sshCredentials).where(eq(schema.sshCredentials.id, input.id));
    if (existing) {
      await audit({
        userId: context.userId,
        action: "credential.delete",
        targetType: "credential",
        targetId: input.id,
        metadata: { label: existing.label, host: existing.host },
        headers: context.headers,
      });
    }
    return { ok: true as const };
  });

const clearHostKey = authed
  .input(CredentialIdInput)
  .output(CredentialSummary)
  .handler(async ({ input, context }) => {
    const [row] = await db
      .update(schema.sshCredentials)
      .set({ hostFingerprint: null, updatedAt: new Date() })
      .where(eq(schema.sshCredentials.id, input.id))
      .returning();
    if (!row) throw new ORPCError("NOT_FOUND", { message: "credential not found" });
    await audit({
      userId: context.userId,
      action: "credential.host_key.changed",
      targetType: "credential",
      targetId: row.id,
      metadata: { reason: "manual_clear" },
      headers: context.headers,
    });
    return serializeCredential(row);
  });

// ---------------------------------------------------------------------------
// Runs procedures
// ---------------------------------------------------------------------------

const listRuns = authed
  .input(
    v.object({
      credentialId: v.optional(v.pipe(v.string(), v.uuid())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))),
    }),
  )
  .output(v.array(RunSummary))
  .handler(async ({ input }) => {
    const where = input.credentialId
      ? eq(schema.updateRuns.credentialId, input.credentialId)
      : undefined;
    const rows = await db
      .select()
      .from(schema.updateRuns)
      .where(where)
      .orderBy(desc(schema.updateRuns.startedAt))
      .limit(input.limit ?? 20);
    return rows.map((r) => ({
      id: r.id,
      credentialId: r.credentialId,
      status: r.status,
      exitCode: r.exitCode,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    }));
  });

const getRun = authed
  .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
  .output(
    v.object({
      run: RunSummary,
      logs: v.array(
        v.object({
          seq: v.number(),
          step: v.string(),
          stream: v.string(),
          line: v.string(),
          emittedAt: v.string(),
        }),
      ),
    }),
  )
  .handler(async ({ input }) => {
    const run = await db.query.updateRuns.findFirst({
      where: eq(schema.updateRuns.id, input.id),
    });
    if (!run) throw new ORPCError("NOT_FOUND");
    const logs = await db
      .select({
        seq: schema.updateRunLogs.seq,
        step: schema.updateRunLogs.step,
        stream: schema.updateRunLogs.stream,
        line: schema.updateRunLogs.line,
        emittedAt: schema.updateRunLogs.emittedAt,
      })
      .from(schema.updateRunLogs)
      .where(eq(schema.updateRunLogs.runId, input.id))
      .orderBy(schema.updateRunLogs.seq);
    return {
      run: {
        id: run.id,
        credentialId: run.credentialId,
        status: run.status,
        exitCode: run.exitCode,
        errorMessage: run.errorMessage,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      },
      logs: logs.map((l) => ({
        seq: l.seq,
        step: l.step,
        stream: l.stream,
        line: l.line,
        emittedAt: l.emittedAt,
      })),
    };
  });

const activeRun = authed
  .output(v.nullable(v.object({ runId: v.string(), credentialId: v.string() })))
  .handler(async () => {
    const id = runLock.active();
    if (!id) return null;
    const run = await db.query.updateRuns.findFirst({
      where: eq(schema.updateRuns.id, id),
    });
    if (!run) return null;
    return { runId: id, credentialId: run.credentialId };
  });

const PreflightCheckOut = v.object({
  id: v.string(),
  label: v.string(),
  value: v.string(),
  status: v.union([v.literal("ok"), v.literal("warn"), v.literal("fail"), v.literal("info")]),
  detail: v.optional(v.string()),
});

const PreflightReportOut = v.object({
  host: v.string(),
  hostFingerprint: v.string(),
  checks: v.array(PreflightCheckOut),
  hasBlockers: v.boolean(),
  hasWarnings: v.boolean(),
});

const preflightRun = authed
  .input(CredentialIdInput)
  .output(PreflightReportOut)
  .handler(async ({ input }) => {
    try {
      const report = await runPreflight(input.id);
      return {
        host: report.host,
        hostFingerprint: report.hostFingerprint,
        checks: report.checks,
        hasBlockers: report.checks.some((c) => c.status === "fail"),
        hasWarnings: report.checks.some((c) => c.status === "warn"),
      };
    } catch (err) {
      if (err instanceof HostKeyMismatchError) {
        throw new ORPCError("FORBIDDEN", {
          message: `host key mismatch: expected ${err.expected}, got ${err.actual}. Inspect the server and clear the pin if the change is legitimate.`,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
    }
  });

const StepStat = v.object({
  step: v.string(),
  avgMs: v.number(),
  samples: v.number(),
});

const RunStatsOut = v.object({
  totalAvgMs: v.number(),
  samples: v.number(),
  steps: v.array(StepStat),
});

const runStats = authed
  .input(v.object({ credentialId: v.optional(v.pipe(v.string(), v.uuid())) }))
  .output(RunStatsOut)
  .handler(async ({ input }) => {
    // Pull the last few successful runs for this credential (or any credential
    // if none specified) and compute per-step averages from the log timestamps.
    const recent = await db
      .select({ id: schema.updateRuns.id })
      .from(schema.updateRuns)
      .where(
        input.credentialId
          ? and(
              eq(schema.updateRuns.status, "success"),
              eq(schema.updateRuns.credentialId, input.credentialId),
            )
          : eq(schema.updateRuns.status, "success"),
      )
      .orderBy(desc(schema.updateRuns.startedAt))
      .limit(5);

    if (recent.length === 0) {
      return { totalAvgMs: 0, samples: 0, steps: [] };
    }

    const stepSums = new Map<string, { totalMs: number; count: number }>();
    let totalMs = 0;
    let totalCount = 0;

    for (const r of recent) {
      const logs = await db
        .select({
          step: schema.updateRunLogs.step,
          emittedAt: schema.updateRunLogs.emittedAt,
        })
        .from(schema.updateRunLogs)
        .where(eq(schema.updateRunLogs.runId, r.id))
        .orderBy(schema.updateRunLogs.seq);

      if (logs.length < 2) continue;

      const stepBounds = new Map<string, { start: number; end: number }>();
      for (const l of logs) {
        const t = new Date(l.emittedAt).getTime();
        const existing = stepBounds.get(l.step);
        if (!existing) stepBounds.set(l.step, { start: t, end: t });
        else existing.end = t;
      }

      let runTotal = 0;
      for (const [step, { start, end }] of stepBounds) {
        const dur = end - start;
        if (dur < 0) continue;
        const acc = stepSums.get(step) ?? { totalMs: 0, count: 0 };
        acc.totalMs += dur;
        acc.count += 1;
        stepSums.set(step, acc);
        runTotal += dur;
      }
      totalMs += runTotal;
      totalCount += 1;
    }

    return {
      totalAvgMs: totalCount > 0 ? Math.round(totalMs / totalCount) : 0,
      samples: totalCount,
      steps: Array.from(stepSums.entries()).map(([step, { totalMs, count }]) => ({
        step,
        avgMs: Math.round(totalMs / count),
        samples: count,
      })),
    };
  });

const triggerRun = authed
  .input(CredentialIdInput)
  .output(v.object({ runId: v.string() }))
  .handler(async ({ input, context }) => {
    if (runLock.active()) {
      throw new ORPCError("CONFLICT", {
        message: "another update is already running",
      });
    }
    const cred = await db.query.sshCredentials.findFirst({
      where: eq(schema.sshCredentials.id, input.id),
    });
    if (!cred) throw new ORPCError("NOT_FOUND", { message: "credential not found" });

    const [run] = await db
      .insert(schema.updateRuns)
      .values({
        credentialId: cred.id,
        triggeredBy: context.userId!,
        status: "pending",
      })
      .returning();
    if (!run) throw new ORPCError("INTERNAL_SERVER_ERROR");

    await audit({
      userId: context.userId,
      action: "run.start",
      targetType: "run",
      targetId: run.id,
      metadata: { credentialId: cred.id, host: cred.host, label: cred.label },
      headers: context.headers,
    });

    // Fire and forget. Errors get persisted by executeRun itself.
    void executeRun(run.id, cred.id).catch((err) => {
      console.error("[runner] unhandled error", err);
    });

    return { runId: run.id };
  });

const cancelRun = authed
  .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
  .output(v.object({ canceled: v.boolean() }))
  .handler(async ({ input, context }) => {
    const ok = runLock.cancel(input.id);
    if (ok) {
      await audit({
        userId: context.userId,
        action: "run.cancel",
        targetType: "run",
        targetId: input.id,
        headers: context.headers,
      });
    }
    return { canceled: ok };
  });

const streamRun = authed
  .input(v.object({ id: v.pipe(v.string(), v.uuid()), fromSeq: v.optional(v.number()) }))
  .output(eventIterator(LogEvent))
  .handler(async function* ({ input, signal }) {
    const { id: runId, fromSeq = 0 } = input;
    // Replay everything we've already persisted so the client gets a complete
    // backlog even if it connects after the run started.
    const existing = await db
      .select()
      .from(schema.updateRunLogs)
      .where(eq(schema.updateRunLogs.runId, runId))
      .orderBy(schema.updateRunLogs.seq);
    for (const row of existing) {
      if (row.seq <= fromSeq) continue;
      yield {
        kind: "log" as const,
        runId,
        step: row.step,
        stream: row.stream,
        seq: row.seq,
        line: row.line,
        at: row.emittedAt,
      };
    }

    // Then attach to the live broadcaster (if the run is still active) and
    // forward events as they arrive. If the run already finished, emit a
    // terminal status event and return.
    const run = await db.query.updateRuns.findFirst({
      where: eq(schema.updateRuns.id, runId),
    });
    if (!run) throw new ORPCError("NOT_FOUND");

    if (run.status !== "pending" && run.status !== "running") {
      yield {
        kind: "status" as const,
        runId,
        status: run.status,
        exitCode: run.exitCode,
        errorMessage: run.errorMessage,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      };
      return;
    }

    const buffer: RunLogEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = runBroadcaster.subscribe(runId, (ev) => {
      buffer.push(ev);
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    });

    const onAbort = () => {
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        if (signal?.aborted) return;
        if (buffer.length === 0) {
          await new Promise<void>((res) => {
            wake = res;
          });
          continue;
        }
        const ev = buffer.shift();
        if (!ev) continue;
        yield ev;
        if (ev.kind === "status" && ev.status !== "running" && ev.status !== "pending") {
          return;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  });

const AuditEventOut = v.object({
  id: v.string(),
  userId: v.nullable(v.string()),
  userEmail: v.nullable(v.string()),
  action: v.string(),
  targetType: v.nullable(v.string()),
  targetId: v.nullable(v.string()),
  metadata: v.nullable(v.record(v.string(), v.unknown())),
  ipAddress: v.nullable(v.string()),
  userAgent: v.nullable(v.string()),
  at: v.string(),
});

const listAuditEvents = authed
  .input(
    v.object({
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
      targetType: v.optional(v.string()),
      targetId: v.optional(v.string()),
    }),
  )
  .output(v.array(AuditEventOut))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: schema.auditEvents.id,
        userId: schema.auditEvents.userId,
        userEmail: schema.users.email,
        action: schema.auditEvents.action,
        targetType: schema.auditEvents.targetType,
        targetId: schema.auditEvents.targetId,
        metadata: schema.auditEvents.metadata,
        ipAddress: schema.auditEvents.ipAddress,
        userAgent: schema.auditEvents.userAgent,
        at: schema.auditEvents.at,
      })
      .from(schema.auditEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.userId))
      .where(
        input.targetType
          ? input.targetId
            ? and(
                eq(schema.auditEvents.targetType, input.targetType),
                eq(schema.auditEvents.targetId, input.targetId),
              )
            : eq(schema.auditEvents.targetType, input.targetType)
          : undefined,
      )
      .orderBy(desc(schema.auditEvents.at))
      .limit(input.limit ?? 50);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      at: r.at.toISOString(),
    }));
  });

export const appRouter = {
  credentials: {
    list: listCredentials,
    get: getCredential,
    create: createCredential,
    update: updateCredential,
    delete: deleteCredential,
    clearHostKey: clearHostKey,
  },
  runs: {
    list: listRuns,
    get: getRun,
    active: activeRun,
    preflight: preflightRun,
    stats: runStats,
    trigger: triggerRun,
    cancel: cancelRun,
    stream: streamRun,
  },
  audit: {
    list: listAuditEvents,
  },
};

export type AppRouter = typeof appRouter;
