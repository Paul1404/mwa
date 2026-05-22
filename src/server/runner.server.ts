import { eq } from "drizzle-orm";
import { audit } from "./audit.server";
import { decrypt } from "./crypto.server";
import { db, schema } from "./db";
import type { UpdateRunStatus } from "./db/schema";
import { type CommandEvent, connect, execStream, HostKeyMismatchError } from "./ssh.server";

export type RunStep = "grafana_down" | "mailcow_update" | "grafana_up" | "docker_prune";

export type RunLogEvent =
  | {
      kind: "log";
      runId: string;
      step: RunStep | "init";
      stream: "stdout" | "stderr" | "system";
      seq: number;
      line: string;
      at: string;
    }
  | {
      kind: "status";
      runId: string;
      status: UpdateRunStatus;
      exitCode: number | null;
      errorMessage: string | null;
      finishedAt: string | null;
    };

const STEPS: { id: RunStep; label: string; command: string }[] = [
  {
    id: "grafana_down",
    label: "Stop Mailcow Grafana stack",
    command: "cd /opt/mailcow-grafana && docker compose down",
  },
  {
    id: "mailcow_update",
    // `--force` makes update.sh non-interactive and auto-confirms all prompts.
    // `--gc` garbage-collects old image tags after the upgrade is in place.
    label: "Run Mailcow updater (non-interactive)",
    command: "cd /opt/mailcow-dockerized && ./update.sh --force --gc",
  },
  {
    id: "grafana_up",
    label: "Start Mailcow Grafana stack",
    command: "cd /opt/mailcow-grafana && docker compose up -d --pull always",
  },
  {
    id: "docker_prune",
    label: "Prune dangling Docker images and layers",
    command: "docker system prune -a --force",
  },
];

class RunLock {
  private currentRunId: string | null = null;
  private controller: AbortController | null = null;

  /** Returns the run id if a run is currently active. */
  active(): string | null {
    return this.currentRunId;
  }

  /** Try to claim the slot. Throws if another run is already in flight. */
  claim(runId: string): AbortController {
    if (this.currentRunId) {
      throw new Error(`another update is already running (run ${this.currentRunId})`);
    }
    this.currentRunId = runId;
    this.controller = new AbortController();
    return this.controller;
  }

  release(runId: string) {
    if (this.currentRunId === runId) {
      this.currentRunId = null;
      this.controller = null;
    }
  }

  cancel(runId: string): boolean {
    if (this.currentRunId === runId && this.controller) {
      this.controller.abort();
      return true;
    }
    return false;
  }
}

export const runLock = new RunLock();

/** PubSub for live tailing of an active run. */
class RunBroadcaster {
  private listeners = new Map<string, Set<(ev: RunLogEvent) => void>>();

  subscribe(runId: string, cb: (ev: RunLogEvent) => void): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(cb);
    return () => {
      const s = this.listeners.get(runId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.listeners.delete(runId);
    };
  }

  publish(ev: RunLogEvent) {
    const set = this.listeners.get(ev.runId);
    if (!set) return;
    for (const cb of set) cb(ev);
  }
}

export const runBroadcaster = new RunBroadcaster();

async function persistLog(
  runId: string,
  seq: number,
  stream: "stdout" | "stderr" | "system",
  step: RunStep | "init",
  line: string,
) {
  await db.insert(schema.updateRunLogs).values({
    runId,
    seq,
    stream,
    step,
    line,
  });
}

async function updateRunStatus(
  runId: string,
  patch: Partial<typeof schema.updateRuns.$inferInsert>,
) {
  await db.update(schema.updateRuns).set(patch).where(eq(schema.updateRuns.id, runId));
}

/**
 * Drive the full Mailcow update pipeline for `runId`. Persists every log line
 * and broadcasts events for any live subscribers. Resolves when the run
 * terminates (success, failure, or cancel). Must NOT be awaited inside the
 * request handler that starts the run -- fire and forget.
 */
export async function executeRun(runId: string, credentialId: string): Promise<void> {
  const controller = runLock.claim(runId);
  const { signal } = controller;
  let seq = 0;

  const emit = async (
    step: RunStep | "init",
    stream: "stdout" | "stderr" | "system",
    line: string,
  ) => {
    seq += 1;
    const ev: RunLogEvent = {
      kind: "log",
      runId,
      step,
      stream,
      seq,
      line,
      at: new Date().toISOString(),
    };
    runBroadcaster.publish(ev);
    await persistLog(runId, seq, stream, step, line);
  };

  const finalize = async (
    status: UpdateRunStatus,
    exitCode: number | null,
    errorMessage: string | null,
  ) => {
    const finishedAt = new Date();
    await updateRunStatus(runId, {
      status,
      exitCode,
      errorMessage,
      finishedAt,
    });
    runBroadcaster.publish({
      kind: "status",
      runId,
      status,
      exitCode,
      errorMessage,
      finishedAt: finishedAt.toISOString(),
    });
  };

  await updateRunStatus(runId, { status: "running" });
  runBroadcaster.publish({
    kind: "status",
    runId,
    status: "running",
    exitCode: null,
    errorMessage: null,
    finishedAt: null,
  });

  try {
    const cred = await db.query.sshCredentials.findFirst({
      where: eq(schema.sshCredentials.id, credentialId),
    });
    if (!cred) throw new Error("credential not found");

    await emit("init", "system", `connecting to ${cred.username}@${cred.host}:${cred.port}`);

    const privateKey = decrypt(cred.privateKeyEnc);
    const passphrase = cred.passphraseEnc ? decrypt(cred.passphraseEnc) : undefined;

    const { client, hostFingerprint } = await connect(
      {
        host: cred.host,
        port: cred.port,
        username: cred.username,
        privateKey,
        passphrase,
        expectedHostFingerprint: cred.hostFingerprint,
      },
      signal,
    );

    if (!cred.hostFingerprint) {
      await db
        .update(schema.sshCredentials)
        .set({ hostFingerprint, updatedAt: new Date() })
        .where(eq(schema.sshCredentials.id, cred.id));
      await emit("init", "system", `pinned host key on first connect: ${hostFingerprint}`);
      await audit({
        userId: null,
        action: "credential.host_key.pinned",
        targetType: "credential",
        targetId: cred.id,
        metadata: { hostFingerprint, runId },
      });
    } else {
      await emit("init", "system", `host key verified: ${hostFingerprint}`);
    }

    await emit("init", "system", "connection established");

    let exitCode: number | null = 0;
    try {
      for (const step of STEPS) {
        if (signal.aborted) throw new Error("aborted");
        await emit(step.id, "system", `==> ${step.label}`);
        await emit(step.id, "system", `$ ${step.command}`);

        const iter = execStream(client, step.command, signal);
        let stepExit: number | null = null;
        for await (const ev of iter as AsyncGenerator<CommandEvent>) {
          if (ev.type === "line") {
            await emit(step.id, ev.stream, ev.line);
          } else {
            stepExit = ev.code;
          }
        }

        if (stepExit !== 0) {
          await emit(step.id, "system", `step failed with exit code ${stepExit ?? "unknown"}`);
          exitCode = stepExit ?? 1;
          break;
        }
        await emit(step.id, "system", "step finished");
      }
    } finally {
      try {
        client.end();
      } catch {
        // ignore
      }
    }

    if (exitCode === 0) {
      await emit("docker_prune", "system", "all steps completed successfully");
      await finalize("success", 0, null);
      await audit({
        userId: null,
        action: "run.complete",
        targetType: "run",
        targetId: runId,
        metadata: { status: "success", credentialId },
      });
    } else {
      await finalize("failed", exitCode, `pipeline halted with exit code ${exitCode}`);
      await audit({
        userId: null,
        action: "run.complete",
        targetType: "run",
        targetId: runId,
        metadata: { status: "failed", exitCode, credentialId },
      });
    }
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.message === "aborted" || err.name === "AbortError" || signal.aborted);
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof HostKeyMismatchError) {
      await emit(
        "init",
        "stderr",
        `host key mismatch! pinned ${err.expected} but server presented ${err.actual}`,
      );
      await emit(
        "init",
        "system",
        "aborting run. inspect the server and, if the new key is legitimate, clear the pin in credential settings.",
      );
      await audit({
        userId: null,
        action: "credential.host_key.changed",
        targetType: "credential",
        targetId: credentialId,
        metadata: { expected: err.expected, actual: err.actual, runId },
      });
    } else {
      await emit("init", "system", aborted ? "run canceled" : `error: ${message}`);
    }
    await finalize(aborted ? "canceled" : "failed", null, message);
    await audit({
      userId: null,
      action: "run.complete",
      targetType: "run",
      targetId: runId,
      metadata: { status: aborted ? "canceled" : "failed", error: message, credentialId },
    });
  } finally {
    runLock.release(runId);
  }
}
