ALTER TABLE "ssh_credentials" ADD COLUMN "mailcow_api_url" varchar(255);
ALTER TABLE "ssh_credentials" ADD COLUMN "mailcow_api_key_enc" text;
ALTER TABLE "ssh_credentials" ADD COLUMN "mail_hostname" varchar(255);
ALTER TABLE "ssh_credentials" ADD COLUMN "abuse_mailbox" varchar(255);
ALTER TABLE "ssh_credentials" ADD COLUMN "tlsa_value" text;

CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"label" varchar(100) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"mta_credential_id" uuid NOT NULL,
	"dns_provider_credential_id" uuid NOT NULL,
	"identity_provider_credential_id" uuid,
	"status" varchar(32) DEFAULT 'planned' NOT NULL,
	"last_plan_id" uuid,
	"last_run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_domain_unique" UNIQUE("domain")
);

CREATE TABLE "domain_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"mta_credential_id" uuid NOT NULL,
	"dns_provider_credential_id" uuid NOT NULL,
	"identity_provider_credential_id" uuid,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"desired_state" jsonb NOT NULL,
	"observed_state" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"blockers" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "domain_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"domain" varchar(255) NOT NULL,
	"triggered_by" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);

CREATE TABLE "domain_run_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stream" varchar(8) NOT NULL,
	"step" varchar(32) NOT NULL,
	"line" text NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domains" ADD CONSTRAINT "domains_mta_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("mta_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domains" ADD CONSTRAINT "domains_dns_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("dns_provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "domains" ADD CONSTRAINT "domains_identity_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("identity_provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "domains" ADD CONSTRAINT "domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domain_plans" ADD CONSTRAINT "domain_plans_mta_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("mta_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domain_plans" ADD CONSTRAINT "domain_plans_dns_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("dns_provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "domain_plans" ADD CONSTRAINT "domain_plans_identity_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("identity_provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "domain_plans" ADD CONSTRAINT "domain_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domain_runs" ADD CONSTRAINT "domain_runs_plan_id_domain_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."domain_plans"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "domain_runs" ADD CONSTRAINT "domain_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "domain_run_logs" ADD CONSTRAINT "domain_run_logs_run_id_domain_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."domain_runs"("id") ON DELETE cascade ON UPDATE no action;
