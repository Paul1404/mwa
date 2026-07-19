# MWA: Mailcow Web Updater

Trigger Mailcow upgrades on a remote server from a browser. The app SSHes
into the target, runs the standard Mailcow update sequence, and streams
the live terminal output back over an authenticated session.

MWA can also provision mail domains onto a configured Mailcow MTA. Domain
provisioning is provider-based: the first shipped adapters manage DNS in
AWS Route 53, sending identity/signing in AWS SES v2, and domain/DKIM state
through the Mailcow API.

MWA also exposes a token-authenticated MCP endpoint for AI-assisted Mailcow
quarantine review. It can list and inspect bounded message previews, then uses
a persisted plan/review/apply flow for release, spam learning, and deletion.

The update pipeline is:

```
cd /opt/mailcow-dockerized && ./update.sh --force
docker system prune -a --force
```

Note: `--gc` is intentionally not passed to `update.sh`. Mailcow treats
`--gc` as a standalone garbage-collect mode that exits without performing
the update. The final `docker system prune -a --force` step handles
cleanup of unused images.

Only one run can be active at a time. Output is line-buffered and
persisted, so you can leave the page and come back without losing logs.

## Stack

TanStack Start (Vite) + TanStack Router on the frontend. oRPC for the
API, with an event-iterator endpoint streaming terminal output. better-auth
for sessions (email + password, sign-up gateable via env). Drizzle ORM on
Postgres. SSH via the `ssh2` library. Bun runtime, deployed on Railway via
Dockerfile.

SSH private keys are encrypted with AES-256-GCM using a key kept in the
`ENCRYPTION_KEY` env var. The encrypted blob never leaves the database
and the raw key is never returned by any API, never logged, never
re-exposed in the UI after creation.

## Run locally

Requires Bun >= 1.2 and a Postgres instance.

```sh
cp .env.example .env
# fill in DATABASE_URL, ENCRYPTION_KEY, BETTER_AUTH_SECRET, BETTER_AUTH_URL

bun install
bun run db:migrate
bun run dev
```

Open http://localhost:3000. The first time you visit, register an account
(sign-up is open by default). After you have one or more users, set
`ALLOW_SIGNUP=false` in production to prevent further registrations.

## Deploy to Railway

1. Create a new service from this repo. Railway will detect the
   `Dockerfile` and use it directly.
2. Attach a Postgres plugin to the service. Railway will inject
   `DATABASE_URL` automatically.
3. Set the remaining variables on the service (see `.env.example`):
   - `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `BETTER_AUTH_SECRET`: same generator
   - `BETTER_AUTH_URL`: your public URL (e.g. `https://mwa.example.com`)
   - `ALLOW_SIGNUP=false` once you have the accounts you want
4. Healthcheck path is `/api/health` (already wired in `railway.toml`).
5. Migrations run on every boot from inside the container, so deploys do
   not need a separate `preDeployCommand`.

## Required environment variables

See `.env.example` for the full list. The ones that matter:

- `DATABASE_URL`: Postgres connection string (provided by Railway).
- `ENCRYPTION_KEY`: 32-byte base64 key for encrypting stored SSH keys.
- `BETTER_AUTH_SECRET`: random secret for session signing.
- `BETTER_AUTH_URL`: the app's public URL.
- `ALLOW_SIGNUP`: `false` to disable new registrations (default `true`).
- `PORT`: Railway injects this; the app reads it automatically.

## Security notes

- The SSH key plaintext is held in memory only during an active run, decrypted
  in the server process, passed to `ssh2`, and dropped when the connection
  ends.
- Sessions are HTTP-only, SameSite=Lax cookies signed by better-auth.
- Every oRPC procedure that touches credentials or runs requires an
  authenticated session. The only public endpoints are auth and the
  healthcheck. `/api/mcp` is reachable without a browser session but requires a
  hashed, scoped, unexpired bearer token created from the authenticated MCP page.
- Losing `ENCRYPTION_KEY` means every stored key becomes unreadable. Rotate
  by re-encrypting rows individually rather than swapping the env var blindly.

## Domain provisioning

Provisioning uses a plan/review/apply flow:

1. Add or edit an SSH credential and fill the domain provisioning fields:
   - Mailcow API URL, for example `https://mail.pdcd.net`
   - Mailcow API key
   - Mail hostname, for example `mail.pdcd.net`
   - Report mailbox, for example `abuse@pdcd.net`
   - Optional TLSA value for DANE
2. Open Domains, add AWS provider credentials, and build a plan for the domain.
3. Review DNS creates/updates/deletes before applying.
4. Apply streams a domain run with persisted logs.

AWS credentials are encrypted at rest with the same `ENCRYPTION_KEY` mechanism
used for SSH keys. Raw provider secrets are never returned by API responses.

The AWS adapters default SES to `eu-central-1`. New SES identities are attached
to the `default-transactional` configuration set unless a different
configuration set is stored on the SES provider.

When SES signing is enabled, SES is treated as authoritative for DKIM. The plan
preserves SES Easy DKIM CNAMEs pointing at `*.dkim.amazonses.com` and removes
other `*._domainkey.<domain>` records plus the Mailcow DKIM key for that
domain. This avoids outbound mail being double-signed by both Mailcow and SES.

Useful manual checks:

```sh
aws --region eu-central-1 sesv2 get-email-identity --email-identity example.com
aws --region eu-central-1 sesv2 list-email-identities
aws route53 list-resource-record-sets --hosted-zone-id ZONE_ID
```

## Quarantine MCP

Open **MCP** in the authenticated app and create a token for a Mailcow credential.
The plaintext token is displayed once; MWA stores only its SHA-256 hash. Tokens
can be read-only or manage-capable, expire automatically, and can be revoked at
any time. Connect an MCP client to:

```text
https://mwa.example.com/api/mcp
Authorization: Bearer mwa_mcp_...
```

The remote endpoint uses stateless Streamable HTTP with JSON responses and
exposes four tools:

- `quarantine_list`: filters bounded quarantine metadata.
- `quarantine_inspect`: parses one message into a capped plain-text preview and
  attachment metadata. Raw MIME and attachment bodies are never returned.
- `quarantine_plan_actions`: persists an exact 10-minute review plan for
  `release`, `learn_spam`, or `delete`.
- `quarantine_apply_actions`: applies only the reviewed plan and exact
  confirmation string.

Email content is untrusted input and every tool tells the client not to treat it
as instructions. Release delivers the message, learns it as ham, and removes it
from quarantine. `learn_spam` trains Rspamd and deletes the message. Plain delete
removes it without training. Plans, successful applications, failures, token
creation, and revocation are recorded in MWA's audit log without message bodies
or secrets.
