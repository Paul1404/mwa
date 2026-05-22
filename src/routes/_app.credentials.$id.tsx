import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/credentials/$id")({
  component: EditCredentialPage,
});

function EditCredentialPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = Route.useParams();
  const cred = useQuery(orpcQuery.credentials.get.queryOptions({ input: { id } }));

  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);

  useEffect(() => {
    if (cred.data) {
      setLabel(cred.data.label);
      setHost(cred.data.host);
      setPort(cred.data.port);
      setUsername(cred.data.username);
    }
  }, [cred.data]);

  const update = useMutation({
    mutationFn: async () =>
      orpc.credentials.update({
        id,
        label,
        host,
        port,
        username,
        privateKey: replaceKey ? privateKey : undefined,
        passphrase: replaceKey ? passphrase || "" : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcQuery.credentials.list.key() });
      queryClient.invalidateQueries({ queryKey: orpcQuery.credentials.get.key({ input: { id } }) });
      router.navigate({ to: "/credentials" });
    },
  });

  const del = useMutation({
    mutationFn: async () => orpc.credentials.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcQuery.credentials.list.key() });
      router.navigate({ to: "/credentials" });
    },
  });

  if (cred.isLoading) return <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>;
  if (cred.error)
    return (
      <p className="text-sm text-[color:var(--color-danger)]">{(cred.error as Error).message}</p>
    );
  if (!cred.data) return null;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{cred.data.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
          >
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid md:grid-cols-[1fr_120px] gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="host">Host</Label>
                <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number.parseInt(e.target.value, 10) || 22)}
                  required
                />
              </div>
            </div>

            <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] p-4 text-xs text-[color:var(--color-muted)]">
              <div className="flex items-center justify-between mb-2">
                <span>
                  Stored key fingerprint:{" "}
                  <span className="font-mono text-[color:var(--color-text)]">
                    {cred.data.publicKeyFingerprint ?? "—"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplaceKey((v) => !v)}
                >
                  {replaceKey ? "Cancel replace" : "Replace key"}
                </Button>
              </div>
              <p>The private key cannot be retrieved. You can only replace it.</p>
            </div>

            {replaceKey ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="privateKey">New private key (PEM)</Label>
                  <Textarea
                    id="privateKey"
                    rows={10}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    required={replaceKey}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="passphrase">Passphrase (optional)</Label>
                  <Input
                    id="passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            ) : null}

            {update.error ? (
              <p className="text-sm text-[color:var(--color-danger)]">
                {(update.error as Error).message}
              </p>
            ) : null}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={del.isPending}
                onClick={() => {
                  if (confirm(`Delete credential "${cred.data?.label}"?`)) del.mutate();
                }}
              >
                Delete
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.navigate({ to: "/credentials" })}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            {del.error ? (
              <p className="text-sm text-[color:var(--color-danger)] text-right">
                {(del.error as Error).message}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
