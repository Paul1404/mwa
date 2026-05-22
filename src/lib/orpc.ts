import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "~/server/orpc/router.server";

// Browser uses location.origin; SSR uses BETTER_AUTH_URL or localhost.
function baseUrl(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  const base = process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base.replace(/\/$/, "")}/api/rpc`;
}

const link = new RPCLink({
  url: baseUrl,
  // Forward cookies on the browser; on SSR each call passes them explicitly.
  fetch: (req, init) => fetch(req, { ...init, credentials: "include" }),
});

export const orpc: RouterClient<AppRouter> = createORPCClient<RouterClient<AppRouter>>(link);
export const orpcQuery = createTanstackQueryUtils(orpc);
