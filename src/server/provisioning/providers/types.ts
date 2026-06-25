export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "SRV" | "TLSA" | "NS" | "SOA";

export type DnsRecord = {
  name: string;
  type: DnsRecordType;
  ttl?: number;
  values?: string[];
  alias?: {
    hostedZoneId: string;
    dnsName: string;
    evaluateTargetHealth: boolean;
  };
};

export type DnsChange = {
  action: "CREATE" | "UPSERT" | "DELETE";
  record: DnsRecord;
  previous?: DnsRecord;
  reason: string;
};

export interface DnsProvider {
  listRecords(domain: string): Promise<DnsRecord[]>;
  applyChanges(changes: DnsChange[]): Promise<void>;
}

export type EmailIdentityState = {
  exists: boolean;
  verified: boolean;
  dkimTokens: string[];
  dkimStatus?: string;
  signingEnabled?: boolean;
  mailFromDomain?: string;
  mailFromStatus?: string;
  configurationSetName?: string;
};

export interface EmailIdentityProvider {
  getIdentity(domain: string): Promise<EmailIdentityState>;
  ensureIdentity(domain: string): Promise<EmailIdentityState>;
  ensureMailFrom(domain: string, mailFromSubdomain: string): Promise<EmailIdentityState>;
  ensureConfigurationSet(domain: string, configurationSetName: string): Promise<void>;
  ensureDkimSigning(domain: string): Promise<void>;
}

export type MtaDomainState = {
  exists: boolean;
  domain: string;
  aliases?: string[];
  dkimSelectors: string[];
};

export interface MtaProvider {
  getDomain(domain: string): Promise<MtaDomainState>;
  ensureDomain(domain: string): Promise<MtaDomainState>;
  deleteDkimSelector(domain: string, selector: string): Promise<void>;
}

export type AwsSecret = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
};

export type AwsProviderConfig = {
  region?: string;
  hostedZoneId?: string;
  configurationSetName?: string;
};
