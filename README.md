# MWA: Mailcow Web Updater

Trigger Mailcow upgrades on a remote server from a browser. The app SSHes
into the target, runs the standard Mailcow update sequence, and streams
the live terminal output back over an authenticated session.

The update pipeline is:

```
cd /opt/mailcow-grafana   && docker compose down
cd /opt/mailcow-dockerized && ./update.sh --force
cd /opt/mailcow-grafana   && docker compose up -d --pull always
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
  healthcheck.
- Losing `ENCRYPTION_KEY` means every stored key becomes unreadable. Rotate
  by re-encrypting rows individually rather than swapping the env var blindly.
