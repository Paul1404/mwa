import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Check, Copy, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/mcp")({
  component: McpPage,
});

type CreatedToken = Awaited<ReturnType<typeof orpc.mcp.createToken>>;

function McpPage() {
  const queryClient = useQueryClient();
  const credentials = useQuery(orpcQuery.credentials.list.queryOptions());
  const tokens = useQuery(orpcQuery.mcp.listTokens.queryOptions());
  const mailcowCredentials = useMemo(
    () => credentials.data?.filter((credential) => credential.mailcowApiUrl) ?? [],
    [credentials.data],
  );
  const [label, setLabel] = useState("Codex quarantine");
  const [credentialId, setCredentialId] = useState("");
  const [scope, setScope] = useState<"read" | "manage">("manage");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!credentialId && mailcowCredentials[0]) setCredentialId(mailcowCredentials[0].id);
  }, [credentialId, mailcowCredentials]);

  const createToken = useMutation({
    mutationFn: () =>
      orpc.mcp.createToken({
        label,
        credentialId,
        scope,
        expiresInDays,
      }),
    onSuccess: (token) => {
      setCreated(token);
      queryClient.invalidateQueries({ queryKey: orpcQuery.mcp.listTokens.key() });
    },
  });
  const revokeToken = useMutation({
    mutationFn: (id: string) => orpc.mcp.revokeToken({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.mcp.listTokens.key() }),
  });

  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-[color:var(--color-accent)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Agent access</h1>
        </div>
        <p className="text-sm text-[color:var(--color-muted)] mt-1 max-w-3xl">
          Give an AI agent bounded access to Mailcow quarantine through MCP. Tokens are scoped to
          one Mailcow credential, stored only as hashes, and can be revoked instantly.
        </p>
      </div>

      {created ? (
        <Card className="border-[color:var(--color-accent)]/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-[color:var(--color-accent)]" /> Save this token now
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-[color:var(--color-muted)]">
              MWA will never show the plaintext token again. Do not paste it into chat or commit it
              to a repository.
            </p>
            <div className="flex gap-2">
              <Input value={created.token} readOnly className="font-mono" />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.token);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="rounded-md bg-[color:var(--color-surface-2)] p-4 text-xs font-mono overflow-x-auto whitespace-pre">
              {JSON.stringify(
                {
                  mcpServers: {
                    mwa: {
                      url: endpoint,
                      headers: { Authorization: `Bearer ${created.token}` },
                    },
                  },
                },
                null,
                2,
              )}
            </div>
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreated(null);
                  createToken.reset();
                }}
              >
                I saved it
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create agent token</CardTitle>
        </CardHeader>
        <CardContent>
          {mailcowCredentials.length > 0 ? (
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createToken.mutate();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-label">Label</Label>
                <Input
                  id="mcp-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-credential">Mailcow</Label>
                <select
                  id="mcp-credential"
                  value={credentialId}
                  onChange={(event) => setCredentialId(event.target.value)}
                  className="h-9 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm"
                  required
                >
                  {mailcowCredentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.label} · {credential.mailcowApiUrl}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-scope">Permission</Label>
                <select
                  id="mcp-scope"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as "read" | "manage")}
                  className="h-9 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm"
                >
                  <option value="manage">Review and act</option>
                  <option value="read">Read only</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-expiry">Expires after days</Label>
                <Input
                  id="mcp-expiry"
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value) || 30)}
                  required
                />
              </div>
              {createToken.error ? (
                <p className="text-sm text-[color:var(--color-danger)] md:col-span-2">
                  {(createToken.error as Error).message}
                </p>
              ) : null}
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={createToken.isPending || !credentialId}>
                  <KeyRound className="size-4" />
                  {createToken.isPending ? "Creating..." : "Create token"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-start gap-3 text-sm text-[color:var(--color-muted)]">
              <ShieldAlert className="size-5 shrink-0 text-amber-300" />
              Add a Mailcow API URL and key to an SSH credential before creating an MCP token.
            </div>
          )}
        </CardContent>
      </Card>

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wide mb-3">
          Existing tokens
        </h2>
        <Card>
          <CardContent className="py-2">
            {tokens.data && tokens.data.length > 0 ? (
              <ul className="divide-y divide-[color:var(--color-border)]">
                {tokens.data.map((token) => {
                  const expired =
                    token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now();
                  const inactive = Boolean(token.revokedAt || expired);
                  return (
                    <li key={token.id} className="py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{token.label}</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-[color:var(--color-surface-2)] text-[color:var(--color-muted)]">
                            {token.scope}
                          </span>
                          {inactive ? (
                            <span className="text-xs text-[color:var(--color-danger)]">
                              {token.revokedAt ? "revoked" : "expired"}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-[color:var(--color-muted)] mt-1">
                          <span className="font-mono">{token.tokenPrefix}…</span>
                          <span> · {token.credentialLabel}</span>
                          <span>
                            {token.lastUsedAt
                              ? ` · last used ${new Date(token.lastUsedAt).toLocaleString()}`
                              : " · never used"}
                          </span>
                        </div>
                      </div>
                      {!token.revokedAt ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={revokeToken.isPending}
                          onClick={() => {
                            if (window.confirm(`Revoke MCP token “${token.label}”?`)) {
                              revokeToken.mutate(token.id);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" /> Revoke
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-[color:var(--color-muted)]">
                No MCP tokens yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
