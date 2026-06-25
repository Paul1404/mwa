import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/credentials/new")({
  component: NewCredentialPage,
});

function NewCredentialPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [mailcowApiUrl, setMailcowApiUrl] = useState("");
  const [mailcowApiKey, setMailcowApiKey] = useState("");
  const [mailHostname, setMailHostname] = useState("mail.pdcd.net");
  const [abuseMailbox, setAbuseMailbox] = useState("abuse@pdcd.net");
  const [tlsaValue, setTlsaValue] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      orpc.credentials.create({
        label,
        host,
        port,
        username,
        privateKey,
        passphrase: passphrase || undefined,
        mailcowApiUrl: mailcowApiUrl || undefined,
        mailcowApiKey: mailcowApiKey || undefined,
        mailHostname: mailHostname || undefined,
        abuseMailbox: abuseMailbox || undefined,
        tlsaValue: tlsaValue || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcQuery.credentials.list.key() });
      router.navigate({ to: "/credentials" });
    },
  });

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Add SSH credential</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
          >
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="prod-mailcow"
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
                <Input
                  id="host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="mail.example.com"
                  required
                />
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="privateKey">Private key (PEM)</Label>
              <Textarea
                id="privateKey"
                rows={10}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                required
              />
              <p className="text-xs text-[color:var(--color-muted)]">
                Encrypted at rest. Never returned from the API. The matching public key must be in{" "}
                <code>authorized_keys</code> on the target server.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="passphrase">Passphrase (optional)</Label>
              <Input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="rounded-md border border-[color:var(--color-border)] p-4 flex flex-col gap-4">
              <div>
                <div className="text-sm font-medium">Domain provisioning</div>
                <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                  Optional for updates, required when this MTA provisions domains.
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mailcowApiUrl">mailcow API URL</Label>
                  <Input
                    id="mailcowApiUrl"
                    value={mailcowApiUrl}
                    onChange={(e) => setMailcowApiUrl(e.target.value)}
                    placeholder="https://mail.pdcd.net"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mailcowApiKey">mailcow API key</Label>
                  <Input
                    id="mailcowApiKey"
                    type="password"
                    value={mailcowApiKey}
                    onChange={(e) => setMailcowApiKey(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mailHostname">Mail hostname</Label>
                  <Input
                    id="mailHostname"
                    value={mailHostname}
                    onChange={(e) => setMailHostname(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="abuseMailbox">Report mailbox</Label>
                  <Input
                    id="abuseMailbox"
                    value={abuseMailbox}
                    onChange={(e) => setAbuseMailbox(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tlsaValue">TLSA value (optional)</Label>
                <Textarea
                  id="tlsaValue"
                  rows={2}
                  value={tlsaValue}
                  onChange={(e) => setTlsaValue(e.target.value)}
                />
              </div>
            </div>

            {mut.error ? (
              <p className="text-sm text-[color:var(--color-danger)]">
                {(mut.error as Error).message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.navigate({ to: "/credentials" })}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Saving..." : "Save credential"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
