import { eq } from "drizzle-orm";
import { audit } from "../audit.server";
import { db, schema } from "../db";
import type { DomainRunStatus } from "../db/schema";
import { isDomainkeyRecord, isSesDkimRecord, normalizeRecord } from "./dns-utils.server";
import { desiredDnsRecords, diffDns, type ProvisioningOptions } from "./planner.server";
import {
  createDnsProvider,
  createIdentityProvider,
  createMailcowProvider,
  parseAwsConfig,
} from "./provider-factory.server";
import type { DnsChange } from "./providers/types";

export type DomainRunStep =
  | "init"
  | "mailcow_domain"
  | "ses_identity"
  | "dns_changes"
  | "dkim_cleanup"
  | "verification";

export type DomainRunLogEvent =
  | {
      kind: "log";
      runId: string;
      step: DomainRunStep;
      stream: "stdout" | "stderr" | "system";
      seq: number;
      line: string;
      at: string;
    }
  | {
      kind: "status";
      runId: string;
      status: DomainRunStatus;
      errorMessage: string | null;
      finishedAt: string | null;
    };

class DomainRunLock {
  private activeByDomain = new Map<string, { runId: string; controller: AbortController }>();

  active(domain?: string): string | null {
    if (domain) return this.activeByDomain.get(domain)?.runId ?? null;
    return this.activeByDomain.values().next().value?.runId ?? null;
  }

  claim(domain: string, runId: string): AbortController {
    if (this.activeByDomain.has(domain)) {
      throw new Error(`domain provisioning is already running for ${domain}`);
    }
    const controller = new AbortController();
    this.activeByDomain.set(domain, { runId, controller });
    return controller;
  }

  release(domain: string, runId: string) {
    if (this.activeByDomain.get(domain)?.runId === runId) this.activeByDomain.delete(domain);
  }

  cancel(runId: string): boolean {
    for (const entry of this.activeByDomain.values()) {
      if (entry.runId === runId) {
        entry.controller.abort();
        return true;
      }
    }
    return false;
  }
}

class DomainRunBroadcaster {
  private listeners = new Map<string, Set<(ev: DomainRunLogEvent) => void>>();

  subscribe(runId: string, cb: (ev: DomainRunLogEvent) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(cb);
    this.listeners.set(runId, set);
    return () => {
      const current = this.listeners.get(runId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.listeners.delete(runId);
    };
  }

  publish(ev: DomainRunLogEvent) {
    for (const cb of this.listeners.get(ev.runId) ?? []) cb(ev);
  }
}

export const domainRunLock = new DomainRunLock();
export const domainRunBroadcaster = new DomainRunBroadcaster();

export async function executeDomainRun(runId: string, planId: string): Promise<void> {
  const plan = await db.query.domainPlans.findFirst({
    where: eq(schema.domainPlans.id, planId),
  });
  if (!plan) throw new Error("domain plan not found");

  const controller = domainRunLock.claim(plan.domain, runId);
  const { signal } = controller;
  let seq = 0;

  const emit = async (
    step: DomainRunStep,
    stream: "stdout" | "stderr" | "system",
    line: string,
  ) => {
    seq += 1;
    const at = new Date().toISOString();
    const ev: DomainRunLogEvent = { kind: "log", runId, step, stream, seq, line, at };
    domainRunBroadcaster.publish(ev);
    await db.insert(schema.domainRunLogs).values({ runId, seq, step, stream, line, emittedAt: at });
  };

  const finalize = async (status: DomainRunStatus, errorMessage: string | null) => {
    const finishedAt = new Date();
    await db
      .update(schema.domainRuns)
      .set({ status, errorMessage, finishedAt })
      .where(eq(schema.domainRuns.id, runId));
    domainRunBroadcaster.publish({
      kind: "status",
      runId,
      status,
      errorMessage,
      finishedAt: finishedAt.toISOString(),
    });
  };

  await db
    .update(schema.domainRuns)
    .set({ status: "running" })
    .where(eq(schema.domainRuns.id, runId));
  domainRunBroadcaster.publish({
    kind: "status",
    runId,
    status: "running",
    errorMessage: null,
    finishedAt: null,
  });

  try {
    const [mta, dnsProviderRow, identityProviderRow] = await Promise.all([
      db.query.sshCredentials.findFirst({
        where: eq(schema.sshCredentials.id, plan.mtaCredentialId),
      }),
      db.query.providerCredentials.findFirst({
        where: eq(schema.providerCredentials.id, plan.dnsProviderCredentialId),
      }),
      plan.identityProviderCredentialId
        ? db.query.providerCredentials.findFirst({
            where: eq(schema.providerCredentials.id, plan.identityProviderCredentialId),
          })
        : Promise.resolve(null),
    ]);
    if (!mta || !dnsProviderRow)
      throw new Error("plan references missing provider or MTA credential");
    const options = ((plan.desiredState as { options?: ProvisioningOptions }).options ?? {
      inboundMail: true,
      sesSigning: true,
      mtaSts: true,
      dane: false,
    }) as ProvisioningOptions;

    await emit("init", "system", `starting domain provisioning for ${plan.domain}`);
    if (signal.aborted) throw new Error("aborted");

    const mtaProvider = createMailcowProvider(mta);
    const dnsProvider = createDnsProvider(dnsProviderRow);
    const identityProvider = identityProviderRow
      ? createIdentityProvider(identityProviderRow)
      : null;
    const identityConfig = identityProviderRow ? parseAwsConfig(identityProviderRow) : {};
    const region = identityConfig.region ?? "eu-central-1";
    const configurationSetName = identityConfig.configurationSetName ?? "default-transactional";

    await emit("mailcow_domain", "system", "ensuring domain exists in mailcow");
    const mailcow = await mtaProvider.ensureDomain(plan.domain);
    await emit(
      "mailcow_domain",
      "system",
      mailcow.exists ? "mailcow domain present" : "mailcow domain created",
    );

    let identity = null;
    if (options.sesSigning && identityProvider) {
      await emit("ses_identity", "system", "ensuring SES identity exists");
      identity = await identityProvider.ensureIdentity(plan.domain);
      await identityProvider.ensureDkimSigning(plan.domain);
      await identityProvider.ensureConfigurationSet(plan.domain, configurationSetName);
      identity = await identityProvider.ensureMailFrom(plan.domain, "bounce");
      await emit(
        "ses_identity",
        "system",
        `SES identity ${identity.verified ? "verified" : "pending"}; DKIM tokens: ${identity.dkimTokens.length}`,
      );
    }

    await emit("dns_changes", "system", "building current DNS change batch");
    const observedDns = (await dnsProvider.listRecords(plan.domain)).map(normalizeRecord);
    const desiredDns = desiredDnsRecords({
      domain: plan.domain,
      mailHostname: mta.mailHostname ?? "mail.pdcd.net",
      abuseMailbox: mta.abuseMailbox ?? "abuse@pdcd.net",
      tlsaValue: options.dane ? mta.tlsaValue : null,
      region,
      options,
      dkimTokens: identity?.dkimTokens ?? [],
    });
    const dnsChanges = diffDns(observedDns, desiredDns)
      .filter((c) => c.provider === "dns")
      .map(
        (c) =>
          ({
            action: c.action,
            record: c.record,
            previous: c.previous,
            reason: c.reason,
          }) satisfies DnsChange,
      );
    await emit("dns_changes", "system", `${dnsChanges.length} DNS creates/updates to apply`);
    await dnsProvider.applyChanges(dnsChanges);

    await emit("dkim_cleanup", "system", "removing non-SES DKIM material");
    const cleanupDns = (await dnsProvider.listRecords(plan.domain)).map(normalizeRecord);
    const deleteChanges: DnsChange[] = cleanupDns
      .filter((r) => isDomainkeyRecord(r, plan.domain) && !isSesDkimRecord(r))
      .map((record) => ({
        action: "DELETE",
        record,
        previous: record,
        reason: "remove non-SES DKIM record to avoid double signing",
      }));
    await dnsProvider.applyChanges(deleteChanges);
    for (const selector of mailcow.dkimSelectors) {
      await mtaProvider.deleteDkimSelector(plan.domain, selector);
      await emit("dkim_cleanup", "system", `deleted mailcow DKIM selector ${selector}`);
      await audit({
        userId: null,
        action: "domain.dkim.delete",
        targetType: "domain",
        targetId: plan.domain,
        metadata: { selector, runId },
      });
    }

    await emit("verification", "system", "checking final provider state");
    if (identityProvider) {
      const finalIdentity = await identityProvider.getIdentity(plan.domain);
      await emit(
        "verification",
        "system",
        `SES verification=${finalIdentity.verified ? "success" : "pending"}, DKIM=${finalIdentity.dkimStatus ?? "unknown"}, MAIL FROM=${finalIdentity.mailFromStatus ?? "unknown"}`,
      );
    }
    await db
      .update(schema.domainPlans)
      .set({ status: "applied" })
      .where(eq(schema.domainPlans.id, planId));
    await upsertDomainRecord(plan, runId);
    await finalize("success", null);
    await audit({
      userId: null,
      action: "domain.run.complete",
      targetType: "domain_run",
      targetId: runId,
      metadata: { domain: plan.domain, status: "success" },
    });
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.message === "aborted" || err.name === "AbortError" || signal.aborted);
    const msg = err instanceof Error ? err.message : String(err);
    await emit("init", aborted ? "system" : "stderr", aborted ? "run canceled" : `error: ${msg}`);
    await finalize(aborted ? "canceled" : "failed", msg);
    await audit({
      userId: null,
      action: "domain.run.complete",
      targetType: "domain_run",
      targetId: runId,
      metadata: { domain: plan.domain, status: aborted ? "canceled" : "failed", error: msg },
    });
  } finally {
    domainRunLock.release(plan.domain, runId);
  }
}

async function upsertDomainRecord(plan: typeof schema.domainPlans.$inferSelect, runId: string) {
  const existing = await db.query.domains.findFirst({
    where: eq(schema.domains.domain, plan.domain),
  });
  if (existing) {
    await db
      .update(schema.domains)
      .set({ status: "active", lastPlanId: plan.id, lastRunId: runId, updatedAt: new Date() })
      .where(eq(schema.domains.id, existing.id));
    return;
  }
  await db.insert(schema.domains).values({
    domain: plan.domain,
    mtaCredentialId: plan.mtaCredentialId,
    dnsProviderCredentialId: plan.dnsProviderCredentialId,
    identityProviderCredentialId: plan.identityProviderCredentialId,
    status: "active",
    lastPlanId: plan.id,
    lastRunId: runId,
    createdBy: plan.createdBy,
  });
}
