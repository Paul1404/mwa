import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// better-auth tables (generated via `bunx @better-auth/cli generate`, hand
// translated to drizzle here so we can co-locate every table in one file).
// Keep column names in lower-camel-case because better-auth's drizzle adapter
// expects them this way out of the box.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// MWA domain tables.
// ---------------------------------------------------------------------------

export const sshCredentials = pgTable("ssh_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: varchar("label", { length: 100 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(22),
  username: varchar("username", { length: 64 }).notNull(),
  // Encrypted private key payload: `${ivB64}:${tagB64}:${cipherB64}`.
  // The raw key never leaves the server; the API surface only ever exposes
  // metadata (label/host/port/username) and never the encrypted blob itself.
  privateKeyEnc: text("private_key_enc").notNull(),
  passphraseEnc: text("passphrase_enc"),
  // SHA-256 fingerprint of the public key, surfaced in the UI so users can
  // verify they configured the right key without ever seeing the secret.
  publicKeyFingerprint: varchar("public_key_fingerprint", { length: 95 }),
  // Pinned SHA-256 fingerprint of the REMOTE host's key (OpenSSH-style:
  // "SHA256:<base64>"). Captured TOFU on first successful connect; later
  // connects compare against this value and refuse on mismatch.
  hostFingerprint: varchar("host_fingerprint", { length: 80 }),
  mailcowApiUrl: varchar("mailcow_api_url", { length: 255 }),
  mailcowApiKeyEnc: text("mailcow_api_key_enc"),
  mailHostname: varchar("mail_hostname", { length: 255 }),
  abuseMailbox: varchar("abuse_mailbox", { length: 255 }),
  tlsaValue: text("tlsa_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

// Single-row-per-key store for app-level state that needs to survive container
// restarts. Currently holds the encryption canary (key = "encryption_canary"):
// a known plaintext encrypted under the active ENCRYPTION_KEY. At boot we try
// to decrypt it -- success means the key in env matches the one used last
// time; failure means the key has changed and every stored credential is now
// unreadable.
export const systemMetadata = pgTable("system_metadata", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 32 }),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const mcpTokenScopes = ["read", "manage"] as const;
export type McpTokenScope = (typeof mcpTokenScopes)[number];

export const mcpAccessTokens = pgTable("mcp_access_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: varchar("label", { length: 100 }).notNull(),
  tokenPrefix: varchar("token_prefix", { length: 20 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  scope: varchar("scope", { length: 16 }).notNull().$type<McpTokenScope>().default("read"),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quarantineActions = ["release", "learn_spam", "delete"] as const;
export type QuarantineAction = (typeof quarantineActions)[number];

export const quarantinePlanStatuses = [
  "pending",
  "applying",
  "applied",
  "failed",
  "expired",
] as const;
export type QuarantinePlanStatus = (typeof quarantinePlanStatuses)[number];

export const quarantineActionPlans = pgTable("quarantine_action_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenId: uuid("token_id")
    .notNull()
    .references(() => mcpAccessTokens.id, { onDelete: "cascade" }),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 24 }).notNull().$type<QuarantineAction>(),
  itemIds: jsonb("item_ids").notNull().$type<string[]>(),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>[]>(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 16 })
    .notNull()
    .$type<QuarantinePlanStatus>()
    .default("pending"),
  errorMessage: text("error_message"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateRunStatus = ["pending", "running", "success", "failed", "canceled"] as const;
export type UpdateRunStatus = (typeof updateRunStatus)[number];

export const updateRuns = pgTable("update_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  triggeredBy: text("triggered_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 16 }).notNull().$type<UpdateRunStatus>().default("pending"),
  exitCode: integer("exit_code"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const updateRunLogs = pgTable("update_run_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => updateRuns.id, { onDelete: "cascade" }),
  // Monotonic sequence number per-run so we can reconstruct order even if
  // many lines land in the same millisecond.
  seq: integer("seq").notNull(),
  // "stdout" | "stderr" | "system" -- system is for our own status messages.
  stream: varchar("stream", { length: 8 }).notNull(),
  // Which of the four pipeline steps emitted the line. Useful for filtering.
  step: varchar("step", { length: 32 }).notNull(),
  line: text("line").notNull(),
  emittedAt: timestamp("emitted_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const providerKinds = ["dns.route53", "identity.ses"] as const;
export type ProviderKind = (typeof providerKinds)[number];

export const providerCredentials = pgTable("provider_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: varchar("kind", { length: 32 }).notNull().$type<ProviderKind>(),
  label: varchar("label", { length: 100 }).notNull(),
  config: jsonb("config").notNull().default({}),
  secretEnc: text("secret_enc").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const domainStatus = [
  "planned",
  "provisioning",
  "active",
  "failed",
  "drift_detected",
] as const;
export type DomainStatus = (typeof domainStatus)[number];

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  mtaCredentialId: uuid("mta_credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  dnsProviderCredentialId: uuid("dns_provider_credential_id")
    .notNull()
    .references(() => providerCredentials.id, { onDelete: "restrict" }),
  identityProviderCredentialId: uuid("identity_provider_credential_id").references(
    () => providerCredentials.id,
    { onDelete: "set null" },
  ),
  status: varchar("status", { length: 32 }).notNull().$type<DomainStatus>().default("planned"),
  lastPlanId: uuid("last_plan_id"),
  lastRunId: uuid("last_run_id"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const domainPlanStatus = ["draft", "applied", "stale"] as const;
export type DomainPlanStatus = (typeof domainPlanStatus)[number];

export const domainPlans = pgTable("domain_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull(),
  mtaCredentialId: uuid("mta_credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  dnsProviderCredentialId: uuid("dns_provider_credential_id")
    .notNull()
    .references(() => providerCredentials.id, { onDelete: "restrict" }),
  identityProviderCredentialId: uuid("identity_provider_credential_id").references(
    () => providerCredentials.id,
    { onDelete: "set null" },
  ),
  status: varchar("status", { length: 32 }).notNull().$type<DomainPlanStatus>().default("draft"),
  desiredState: jsonb("desired_state").notNull(),
  observedState: jsonb("observed_state").notNull(),
  changes: jsonb("changes").notNull(),
  warnings: jsonb("warnings").notNull(),
  blockers: jsonb("blockers").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const domainRunStatus = ["pending", "running", "success", "failed", "canceled"] as const;
export type DomainRunStatus = (typeof domainRunStatus)[number];

export const domainRuns = pgTable("domain_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").references(() => domainPlans.id, { onDelete: "set null" }),
  domain: varchar("domain", { length: 255 }).notNull(),
  triggeredBy: text("triggered_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 16 }).notNull().$type<DomainRunStatus>().default("pending"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const domainRunLogs = pgTable("domain_run_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => domainRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  stream: varchar("stream", { length: 8 }).notNull(),
  step: varchar("step", { length: 32 }).notNull(),
  line: text("line").notNull(),
  emittedAt: timestamp("emitted_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const credentialsRelations = relations(sshCredentials, ({ many, one }) => ({
  runs: many(updateRuns),
  owner: one(users, {
    fields: [sshCredentials.createdBy],
    references: [users.id],
  }),
}));

export const runRelations = relations(updateRuns, ({ many, one }) => ({
  credential: one(sshCredentials, {
    fields: [updateRuns.credentialId],
    references: [sshCredentials.id],
  }),
  triggeredByUser: one(users, {
    fields: [updateRuns.triggeredBy],
    references: [users.id],
  }),
  logs: many(updateRunLogs),
}));

export const runLogRelations = relations(updateRunLogs, ({ one }) => ({
  run: one(updateRuns, {
    fields: [updateRunLogs.runId],
    references: [updateRuns.id],
  }),
}));

export const providerCredentialRelations = relations(providerCredentials, ({ one }) => ({
  owner: one(users, {
    fields: [providerCredentials.createdBy],
    references: [users.id],
  }),
}));

export const mcpAccessTokenRelations = relations(mcpAccessTokens, ({ one, many }) => ({
  credential: one(sshCredentials, {
    fields: [mcpAccessTokens.credentialId],
    references: [sshCredentials.id],
  }),
  owner: one(users, {
    fields: [mcpAccessTokens.createdBy],
    references: [users.id],
  }),
  quarantinePlans: many(quarantineActionPlans),
}));

export const quarantineActionPlanRelations = relations(quarantineActionPlans, ({ one }) => ({
  token: one(mcpAccessTokens, {
    fields: [quarantineActionPlans.tokenId],
    references: [mcpAccessTokens.id],
  }),
  credential: one(sshCredentials, {
    fields: [quarantineActionPlans.credentialId],
    references: [sshCredentials.id],
  }),
}));

export const domainRelations = relations(domains, ({ one }) => ({
  mtaCredential: one(sshCredentials, {
    fields: [domains.mtaCredentialId],
    references: [sshCredentials.id],
  }),
  dnsProvider: one(providerCredentials, {
    fields: [domains.dnsProviderCredentialId],
    references: [providerCredentials.id],
  }),
  identityProvider: one(providerCredentials, {
    fields: [domains.identityProviderCredentialId],
    references: [providerCredentials.id],
  }),
}));

export const domainPlanRelations = relations(domainPlans, ({ one, many }) => ({
  mtaCredential: one(sshCredentials, {
    fields: [domainPlans.mtaCredentialId],
    references: [sshCredentials.id],
  }),
  dnsProvider: one(providerCredentials, {
    fields: [domainPlans.dnsProviderCredentialId],
    references: [providerCredentials.id],
  }),
  identityProvider: one(providerCredentials, {
    fields: [domainPlans.identityProviderCredentialId],
    references: [providerCredentials.id],
  }),
  runs: many(domainRuns),
}));

export const domainRunRelations = relations(domainRuns, ({ one, many }) => ({
  plan: one(domainPlans, {
    fields: [domainRuns.planId],
    references: [domainPlans.id],
  }),
  triggeredByUser: one(users, {
    fields: [domainRuns.triggeredBy],
    references: [users.id],
  }),
  logs: many(domainRunLogs),
}));

export const domainRunLogRelations = relations(domainRunLogs, ({ one }) => ({
  run: one(domainRuns, {
    fields: [domainRunLogs.runId],
    references: [domainRuns.id],
  }),
}));
