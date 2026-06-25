import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
  PutEmailIdentityConfigurationSetAttributesCommand,
  PutEmailIdentityDkimAttributesCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import type {
  AwsProviderConfig,
  AwsSecret,
  EmailIdentityProvider,
  EmailIdentityState,
} from "./types";

export class SesIdentityProvider implements EmailIdentityProvider {
  readonly region: string;
  private client: SESv2Client;

  constructor(secret: AwsSecret, config: AwsProviderConfig = {}) {
    this.region = config.region ?? "eu-central-1";
    this.client = new SESv2Client({
      region: this.region,
      credentials: {
        accessKeyId: secret.accessKeyId,
        secretAccessKey: secret.secretAccessKey,
        sessionToken: secret.sessionToken ?? undefined,
      },
    });
  }

  async getIdentity(domain: string): Promise<EmailIdentityState> {
    try {
      const res = await this.client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      return {
        exists: true,
        verified: res.VerifiedForSendingStatus === true || res.VerificationStatus === "SUCCESS",
        dkimTokens: res.DkimAttributes?.Tokens ?? [],
        dkimStatus: res.DkimAttributes?.Status,
        signingEnabled: res.DkimAttributes?.SigningEnabled,
        mailFromDomain: res.MailFromAttributes?.MailFromDomain,
        mailFromStatus: res.MailFromAttributes?.MailFromDomainStatus,
        configurationSetName: res.ConfigurationSetName,
      };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        (err as { name?: string }).name === "NotFoundException"
      ) {
        return { exists: false, verified: false, dkimTokens: [] };
      }
      throw err;
    }
  }

  async ensureIdentity(domain: string): Promise<EmailIdentityState> {
    const existing = await this.getIdentity(domain);
    if (existing.exists) return existing;
    const created = await this.client.send(
      new CreateEmailIdentityCommand({ EmailIdentity: domain }),
    );
    return {
      exists: true,
      verified: false,
      dkimTokens: created.DkimAttributes?.Tokens ?? [],
      dkimStatus: created.DkimAttributes?.Status,
      signingEnabled: created.DkimAttributes?.SigningEnabled,
    };
  }

  async ensureMailFrom(domain: string, mailFromSubdomain: string): Promise<EmailIdentityState> {
    await this.client.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: domain,
        MailFromDomain: `${mailFromSubdomain}.${domain}`,
        BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      }),
    );
    return this.getIdentity(domain);
  }

  async ensureConfigurationSet(domain: string, configurationSetName: string): Promise<void> {
    if (!configurationSetName) return;
    await this.client.send(
      new PutEmailIdentityConfigurationSetAttributesCommand({
        EmailIdentity: domain,
        ConfigurationSetName: configurationSetName,
      }),
    );
  }

  async ensureDkimSigning(domain: string): Promise<void> {
    await this.client.send(
      new PutEmailIdentityDkimAttributesCommand({
        EmailIdentity: domain,
        SigningEnabled: true,
      }),
    );
  }
}
