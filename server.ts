// Production entry: serves /dist/client static assets, then defers to the
// TanStack Start fetch handler for everything else. Used in the Docker
// runner stage. Locally the Vite dev server replaces this.

import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import app from "./dist/server/server.js";
import { waitForDatabaseWake } from "./src/server/db/wake-gate";
import { isTransientDatabaseWakeError } from "./src/server/db/wake-retry";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = resolve("./dist/client");

const STATIC_CACHE_CONTROL = "public, max-age=86400, immutable";
const SHORT_CACHE_CONTROL = "public, max-age=300";

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(path: string) {
  return MIME[extname(path)] ?? "application/octet-stream";
}

function safeStaticPath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const cleaned = normalize(decoded).replace(/^\/+/, "");
  if (cleaned.includes("..")) return null;
  const candidate = join(CLIENT_DIR, cleaned);
  if (!candidate.startsWith(CLIENT_DIR)) return null;
  if (!existsSync(candidate)) return null;
  if (!statSync(candidate).isFile()) return null;
  return candidate;
}

Bun.serve({
  port: PORT,
  development: false,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" || req.method === "HEAD") {
      const filePath = safeStaticPath(url.pathname);
      if (filePath) {
        const isAsset = filePath.includes(`${CLIENT_DIR}/assets/`);
        const isFavicon = /\/(favicon|icon-|apple-touch-icon|manifest)\.[a-z0-9]+$/i.test(filePath);
        const headers: Record<string, string> = {
          "content-type": mimeFor(filePath),
          "cache-control": isAsset
            ? STATIC_CACHE_CONTROL
            : isFavicon
              ? STATIC_CACHE_CONTROL
              : SHORT_CACHE_CONTROL,
        };
        return new Response(Bun.file(filePath), { headers });
      }
    }

    // Keep the liveness endpoint independent from Postgres. All real app and
    // API traffic waits here before auth or route code can touch a waking DB.
    if (url.pathname !== "/api/health") {
      try {
        await waitForDatabaseWake();
      } catch (err) {
        if (isTransientDatabaseWakeError(err)) {
          return new Response("database is waking; retry shortly", {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
              "retry-after": "2",
            },
          });
        }
        throw err;
      }
    }

    return app.fetch(req);
  },
  error(err) {
    console.error("[server]", err);
    return new Response("internal server error", { status: 500 });
  },
});

console.log(`[server] listening on http://0.0.0.0:${PORT}`);
