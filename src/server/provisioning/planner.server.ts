import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  fqdn,
  isDomainkeyRecord,
  isSesDkimRecord,
  normalizeRecord,
  recordKey,
  sameRecord,
} from "./dns-utils.server";
import {
  createDnsProvider,
  createIdentityProvider,
  createMailcowProvider,
  parseAwsConfig,
} from "./provider-factory.server";
import type { DnsChange, DnsRecord, EmailIdentityState, MtaDomainState } from "./providers/types";

export type ProvisioningOptions = {
  inboundMail: boolean;
  sesSigning: boolean;
  mtaSts: boolean;
  dane: boolean;
};

export type PlanInput = {
  domain: string;
  mtaCredentialId: string;
  dnsProviderCredentialId: string;
  identityProviderCredentialId?: string | null;
  options: ProvisioningOptions;
};

export type DomainPlanChange =
  | ({ provider: "dns" } & DnsChange)
  | { provider: "mailcow"; action: "ensure_domain"; domain: string; reason: string }
  | { provider: "mailcow"; action: "delete_dkim"; domain: string; selector: string; reason: string }
  | { provider: "ses"; action: "ensure_identity"; domain: string; reason: string }
  | {
      provider: "ses";
      action: "ensure_mail_from";
      domain: string;
      mailFromDomain: string;
      reason: string;
    }
  | {
      provider: "ses";
      action: "ensure_config_set";
      domain: string;
      configurationSetName: string;
      reason: string;
    };

export type BuiltDomainPlan = {
  domain: string;
  desiredState: Record<string, unknown>;
  observedState: {
    dnsRecords: DnsRecord[];
    identity: EmailIdentityState | null;
    mailcow: MtaDomainState | null;
  };
  changes: DomainPlanChange[];
  warnings: string[];
  blockers: string[];
};

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export async function buildDomainPlan(input: PlanInput): Promise<BuiltDomainPlan> {
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain)) throw new Error("invalid domain name");

  const [mta, dnsProviderRow, identityProviderRow] = await Promise.all([
    db.query.sshCredentials.findFirst({
      where: eq(schema.sshCredentials.id, input.mtaCredentialId),
    }),
    db.query.providerCredentials.findFirst({
      where: eq(schema.providerCredentials.id, input.dnsProviderCredentialId),
    }),
    input.identityProviderCredentialId
      ? db.query.providerCredentials.findFirst({
          where: eq(schema.providerCredentials.id, input.identityProviderCredentialId),
        })
      : Promise.resolve(null),
  ]);
  if (!mta) throw new Error("MTA credential not found");
  if (!dnsProviderRow) throw new Error("DNS provider not found");
  if (input.options.sesSigning && !identityProviderRow) {
    throw new Error("identity provider is required when SES signing is enabled");
  }

  const dnsProvider = createDnsProvider(dnsProviderRow);
  const mtaProvider = createMailcowProvider(mta);
  const identityProvider = identityProviderRow ? createIdentityProvider(identityProviderRow) : null;

  const blockers: string[] = [];
  const warnings: string[] = [];
  let dnsRecords: DnsRecord[] = [];
  let identity: EmailIdentityState | null = null;
  let mailcow: MtaDomainState | null = null;

  try {
    dnsRecords = (await dnsProvider.listRecords(domain)).map(normalizeRecord);
  } catch (err) {
    blockers.push(`DNS discovery failed: ${message(err)}`);
  }
  try {
    mailcow = await mtaProvider.getDomain(domain);
  } catch (err) {
    blockers.push(`mailcow discovery failed: ${message(err)}`);
  }
  if (identityProvider) {
    try {
      identity = await identityProvider.getIdentity(domain);
    } catch (err) {
      blockers.push(`SES discovery failed: ${message(err)}`);
    }
  }

  const region = identityProviderRow
    ? (parseAwsConfig(identityProviderRow).region ?? "eu-central-1")
    : "eu-central-1";
  const configurationSetName = identityProviderRow
    ? (parseAwsConfig(identityProviderRow).configurationSetName ?? "default-transactional")
    : null;
  const desiredDns = desiredDnsRecords({
    domain,
    mailHostname: mta.mailHostname ?? "mail.pdcd.net",
    abuseMailbox: mta.abuseMailbox ?? "abuse@pdcd.net",
    tlsaValue: input.options.dane ? mta.tlsaValue : null,
    region,
    options: input.options,
    dkimTokens: identity?.dkimTokens ?? [],
  });

  const changes: DomainPlanChange[] = [];
  if (mailcow && !mailcow.exists) {
    changes.push({
      provider: "mailcow",
      action: "ensure_domain",
      domain,
      reason: "domain missing in mailcow",
    });
  }
  if (input.options.sesSigning && identity && !identity.exists) {
    changes.push({
      provider: "ses",
      action: "ensure_identity",
      domain,
      reason: "SES identity missing",
    });
    warnings.push(
      "SES identity does not exist yet; DKIM DNS records will be generated during apply.",
    );
  }
  if (input.options.sesSigning && identity?.exists && !identity.verified) {
    warnings.push("SES identity exists but is not verified for sending yet.");
  }
  if (input.options.sesSigning && identityProviderRow && configurationSetName) {
    changes.push({
      provider: "ses",
      action: "ensure_config_set",
      domain,
      configurationSetName,
      reason: "ensure SES configuration set",
    });
  }
  if (input.options.sesSigning) {
    changes.push({
      provider: "ses",
      action: "ensure_mail_from",
      domain,
      mailFromDomain: `bounce.${domain}`,
      reason: "ensure SES custom MAIL FROM",
    });
  }

  changes.push(...diffDns(dnsRecords, desiredDns));

  if (input.options.sesSigning) {
    const nonSesDkim = dnsRecords.filter(
      (r) => isDomainkeyRecord(r, domain) && !isSesDkimRecord(r),
    );
    for (const record of nonSesDkim) {
      if (record.type === "NS" || record.type === "SOA") continue;
      changes.push({
        provider: "dns",
        action: "DELETE",
        record,
        previous: record,
        reason: "remove non-SES DKIM record to avoid double signing",
      });
    }
    if (nonSesDkim.length > 0) warnings.push("Non-SES DKIM DNS records will be deleted.");
    for (const selector of mailcow?.dkimSelectors ?? []) {
      changes.push({
        provider: "mailcow",
        action: "delete_dkim",
        domain,
        selector,
        reason: "remove mailcow DKIM key because SES signing is authoritative",
      });
    }
  }

  return {
    domain,
    desiredState: { dnsRecords: desiredDns, options: input.options },
    observedState: { dnsRecords, identity, mailcow },
    changes,
    warnings,
    blockers,
  };
}

export function desiredDnsRecords(input: {
  domain: string;
  mailHostname: string;
  abuseMailbox: string;
  tlsaValue?: string | null;
  region: string;
  options: ProvisioningOptions;
  dkimTokens: string[];
}): DnsRecord[] {
  const out: DnsRecord[] = [];
  const domain = input.domain;
  if (input.options.inboundMail) {
    out.push(
      rec(domain, "MX", [`10 ${input.mailHostname}`]),
      rec(domain, "TXT", ["v=spf1 include:pdcd.net ~all"]),
      rec(`_dmarc.${domain}`, "TXT", [`v=DMARC1; p=quarantine; rua=mailto:${input.abuseMailbox}`]),
      rec(`autoconfig.${domain}`, "CNAME", [input.mailHostname]),
      rec(`autodiscover.${domain}`, "CNAME", [input.mailHostname]),
      rec(`_autodiscover._tcp.${domain}`, "SRV", [`10 10 443 ${input.mailHostname}`]),
    );
  }
  if (input.options.sesSigning) {
    for (const token of input.dkimTokens) {
      out.push(rec(`${token}._domainkey.${domain}`, "CNAME", [`${token}.dkim.amazonses.com`]));
    }
    out.push(
      rec(`bounce.${domain}`, "MX", [`10 feedback-smtp.${input.region}.amazonses.com`]),
      rec(`bounce.${domain}`, "TXT", ["v=spf1 include:amazonses.com ~all"]),
    );
  }
  if (input.options.mtaSts) {
    out.push(
      rec(`_mta-sts.${domain}`, "TXT", [
        `v=STSv1; id=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
      ]),
      rec(`mta-sts.${domain}`, "CNAME", [input.mailHostname]),
      rec(`_smtp._tls.${domain}`, "TXT", [`v=TLSRPTv1; rua=mailto:${input.abuseMailbox}`]),
    );
  }
  if (input.options.dane && input.tlsaValue) {
    out.push(rec(`_25._tcp.mail.${domain}`, "TLSA", [input.tlsaValue]));
  }
  return out.map(normalizeRecord);
}

export function diffDns(observed: DnsRecord[], desired: DnsRecord[]): DomainPlanChange[] {
  const byKey = new Map(observed.map((r) => [recordKey(r), r]));
  const changes: DomainPlanChange[] = [];
  for (const wanted of desired) {
    const existing = byKey.get(recordKey(wanted));
    if (!existing) {
      changes.push({
        provider: "dns",
        action: "CREATE",
        record: wanted,
        reason: "managed DNS record missing",
      });
    } else if (!sameRecord(existing, wanted)) {
      changes.push({
        provider: "dns",
        action: "UPSERT",
        record: wanted,
        previous: existing,
        reason: "managed DNS record differs",
      });
    }
  }
  return changes;
}

function rec(name: string, type: DnsRecord["type"], values: string[]): DnsRecord {
  return { name: fqdn(name), type, ttl: 300, values };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
