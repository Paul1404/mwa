import type { DnsRecord } from "./providers/types";

export function fqdn(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

export function bareDomain(name: string): string {
  return fqdn(name).slice(0, -1);
}

export function normalizeTxtValue(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && !v.includes('" "')) {
    v = v.slice(1, -1);
  }
  v = v.replace(/"\s+"/g, "");
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

export function normalizeRecord(record: DnsRecord): DnsRecord {
  return {
    ...record,
    name: fqdn(record.name),
    values: record.values?.map((v) =>
      record.type === "TXT" ? normalizeTxtValue(v) : v.trim().replace(/\.$/, ""),
    ),
    alias: record.alias ? { ...record.alias, dnsName: fqdn(record.alias.dnsName) } : undefined,
  };
}

export function recordKey(record: Pick<DnsRecord, "name" | "type">): string {
  return `${fqdn(record.name)}|${record.type}`;
}

export function sameRecord(a: DnsRecord, b: DnsRecord): boolean {
  const na = normalizeRecord(a);
  const nb = normalizeRecord(b);
  if (na.name !== nb.name || na.type !== nb.type) return false;
  if (!!na.alias !== !!nb.alias) return false;
  if (na.alias && nb.alias) {
    return (
      na.alias.hostedZoneId === nb.alias.hostedZoneId &&
      na.alias.dnsName === nb.alias.dnsName &&
      na.alias.evaluateTargetHealth === nb.alias.evaluateTargetHealth
    );
  }
  const av = [...(na.values ?? [])].sort();
  const bv = [...(nb.values ?? [])].sort();
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}

export function isSesDkimRecord(record: DnsRecord): boolean {
  if (record.type !== "CNAME") return false;
  if (!fqdn(record.name).includes("._domainkey.")) return false;
  return (record.values ?? []).some((v) => fqdn(v).endsWith(".dkim.amazonses.com."));
}

export function isDomainkeyRecord(record: DnsRecord, domain: string): boolean {
  return fqdn(record.name).endsWith(`._domainkey.${fqdn(domain)}`);
}

export function txt(value: string): string {
  return value;
}
