import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

type McpTokenRow = typeof schema.mcpAccessTokens.$inferSelect;
type CredentialRow = typeof schema.sshCredentials.$inferSelect;

export type McpAuthContext = {
  token: McpTokenRow;
  credential: CredentialRow;
  headers: Headers;
};

export function generateMcpToken(): { raw: string; hash: string; prefix: string } {
  const raw = `mwa_mcp_${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hash: hashMcpToken(raw),
    prefix: raw.slice(0, 16),
  };
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function authenticateMcpRequest(request: Request): Promise<McpAuthContext | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const raw = authorization.slice("Bearer ".length).trim();
  if (!raw.startsWith("mwa_mcp_") || raw.length < 32) return null;

  const rows = await db
    .select({ token: schema.mcpAccessTokens, credential: schema.sshCredentials })
    .from(schema.mcpAccessTokens)
    .innerJoin(
      schema.sshCredentials,
      eq(schema.sshCredentials.id, schema.mcpAccessTokens.credentialId),
    )
    .where(eq(schema.mcpAccessTokens.tokenHash, hashMcpToken(raw)))
    .limit(1);
  const row = rows[0];
  if (!row || row.token.revokedAt) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= Date.now()) return null;

  const staleBefore = Date.now() - 5 * 60 * 1000;
  if (!row.token.lastUsedAt || row.token.lastUsedAt.getTime() < staleBefore) {
    const now = new Date();
    await db
      .update(schema.mcpAccessTokens)
      .set({ lastUsedAt: now })
      .where(eq(schema.mcpAccessTokens.id, row.token.id));
    row.token.lastUsedAt = now;
  }

  return { token: row.token, credential: row.credential, headers: request.headers };
}

export function mcpUnauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Valid MWA MCP bearer token required" },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="mwa-mcp"',
      },
    },
  );
}
