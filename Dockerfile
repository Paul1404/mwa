# syntax=docker/dockerfile:1.7

# ---------- builder ----------
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app

# Native deps need a toolchain for `bun install` (ssh2, cpu-features, sharp).
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---------- production deps ----------
# Bun auto-install cannot resolve some peer/optional-peer deps reliably in the
# runner stage (kysely, better-call, etc.), so we install once into a clean
# stage and copy node_modules over. Production set excludes drizzle-kit and
# friends since migrations run via a runtime-only entry.
FROM oven/bun:1.3.14-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production

# ---------- runner ----------
FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ca-certificates tini libc6-compat && update-ca-certificates

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist         ./dist
COPY --from=builder   /app/drizzle      ./drizzle
COPY --from=builder   /app/server.ts    ./server.ts
COPY --from=builder   /app/package.json ./package.json
COPY --from=builder   /app/src/server/db/migrate.ts ./src/server/db/migrate.ts
COPY --from=builder   /app/src/server/db/schema.ts  ./src/server/db/schema.ts
COPY --from=builder   /app/src/server/db/index.ts   ./src/server/db/index.ts

EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "bun run src/server/db/migrate.ts && bun run server.ts"]
