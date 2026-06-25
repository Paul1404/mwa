import { decrypt } from "../crypto.server";
import type { schema } from "../db";
import { MailcowProvider } from "./providers/mailcow.server";
import { Route53Provider } from "./providers/route53.server";
import { SesIdentityProvider } from "./providers/ses.server";
import type { AwsProviderConfig, AwsSecret } from "./providers/types";

type ProviderRow = typeof schema.providerCredentials.$inferSelect;
type CredentialRow = typeof schema.sshCredentials.$inferSelect;

export function parseAwsSecret(row: ProviderRow): AwsSecret {
  return JSON.parse(decrypt(row.secretEnc)) as AwsSecret;
}

export function parseAwsConfig(row: ProviderRow): AwsProviderConfig {
  return (row.config ?? {}) as AwsProviderConfig;
}

export function createDnsProvider(row: ProviderRow) {
  if (row.kind !== "dns.route53") throw new Error(`unsupported DNS provider ${row.kind}`);
  return new Route53Provider(parseAwsSecret(row), parseAwsConfig(row));
}

export function createIdentityProvider(row: ProviderRow) {
  if (row.kind !== "identity.ses") throw new Error(`unsupported identity provider ${row.kind}`);
  return new SesIdentityProvider(parseAwsSecret(row), parseAwsConfig(row));
}

export function createMailcowProvider(row: CredentialRow) {
  if (!row.mailcowApiUrl || !row.mailcowApiKeyEnc) {
    throw new Error("MTA credential is missing mailcow API URL or API key");
  }
  return new MailcowProvider({
    apiUrl: row.mailcowApiUrl,
    apiKey: decrypt(row.mailcowApiKeyEnc),
  });
}
