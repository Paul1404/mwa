import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  type ResourceRecordSet,
  Route53Client,
  type RRType,
} from "@aws-sdk/client-route-53";
import { fqdn } from "../dns-utils.server";
import type { AwsProviderConfig, AwsSecret, DnsChange, DnsProvider, DnsRecord } from "./types";

export class Route53Provider implements DnsProvider {
  private client: Route53Client;
  private hostedZoneId?: string;

  constructor(secret: AwsSecret, config: AwsProviderConfig = {}) {
    this.hostedZoneId = config.hostedZoneId;
    this.client = new Route53Client({
      // Route 53 is global, but the AWS SDK still requires a signing region.
      region: "us-east-1",
      credentials: {
        accessKeyId: secret.accessKeyId,
        secretAccessKey: secret.secretAccessKey,
        sessionToken: secret.sessionToken ?? undefined,
      },
    });
  }

  async listRecords(domain: string): Promise<DnsRecord[]> {
    const zoneId = await this.resolveHostedZoneId(domain);
    const out: DnsRecord[] = [];
    let startRecordName: string | undefined;
    let startRecordType: string | undefined;
    do {
      const res = await this.client.send(
        new ListResourceRecordSetsCommand({
          HostedZoneId: zoneId,
          StartRecordName: startRecordName,
          StartRecordType: startRecordType as RRType | undefined,
        }),
      );
      for (const rr of res.ResourceRecordSets ?? []) out.push(fromAwsRecord(rr));
      startRecordName = res.NextRecordName;
      startRecordType = res.NextRecordType;
    } while (startRecordName);
    return out;
  }

  async applyChanges(changes: DnsChange[]): Promise<void> {
    if (changes.length === 0) return;
    const first = changes[0]!.record.name;
    const zoneId = await this.resolveHostedZoneId(first);
    await this.client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Changes: changes.map((change) => ({
            Action: change.action,
            ResourceRecordSet: toAwsRecord(
              change.action === "DELETE" && change.previous ? change.previous : change.record,
            ),
          })),
        },
      }),
    );
  }

  private async resolveHostedZoneId(domain: string): Promise<string> {
    if (this.hostedZoneId) return this.hostedZoneId;
    const name = fqdn(domain);
    const res = await this.client.send(new ListHostedZonesByNameCommand({ DNSName: name }));
    const zone = (res.HostedZones ?? []).find((z) => z.Name === name);
    if (!zone?.Id) throw new Error(`Route 53 hosted zone not found for ${domain}`);
    this.hostedZoneId = zone.Id.replace(/^\/hostedzone\//, "");
    return this.hostedZoneId;
  }
}

function fromAwsRecord(rr: ResourceRecordSet): DnsRecord {
  return {
    name: fqdn(rr.Name ?? ""),
    type: rr.Type as DnsRecord["type"],
    ttl: rr.TTL,
    values: rr.ResourceRecords?.map((r) => r.Value ?? ""),
    alias: rr.AliasTarget
      ? {
          hostedZoneId: rr.AliasTarget.HostedZoneId ?? "",
          dnsName: fqdn(rr.AliasTarget.DNSName ?? ""),
          evaluateTargetHealth: rr.AliasTarget.EvaluateTargetHealth ?? false,
        }
      : undefined,
  };
}

function quoteTxt(value: string): string {
  if (value.startsWith('"')) return value;
  if (value.length <= 255) return `"${value}"`;
  const chunks = value.match(/.{1,255}/g) ?? [value];
  return chunks.map((c) => `"${c}"`).join("");
}

function toAwsRecord(record: DnsRecord): ResourceRecordSet {
  if (record.alias) {
    return {
      Name: fqdn(record.name),
      Type: record.type as ResourceRecordSet["Type"],
      AliasTarget: {
        HostedZoneId: record.alias.hostedZoneId,
        DNSName: fqdn(record.alias.dnsName),
        EvaluateTargetHealth: record.alias.evaluateTargetHealth,
      },
    };
  }
  return {
    Name: fqdn(record.name),
    Type: record.type as ResourceRecordSet["Type"],
    TTL: record.ttl ?? 300,
    ResourceRecords: (record.values ?? []).map((v) => ({
      Value: record.type === "TXT" ? quoteTxt(v) : v,
    })),
  };
}
