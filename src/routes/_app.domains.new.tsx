import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/domains/new")({
  component: NewDomainPage,
});

function NewDomainPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const credentials = useQuery(orpcQuery.credentials.list.queryOptions());
  const providers = useQuery(orpcQuery.providers.list.queryOptions());

  const [domain, setDomain] = useState("");
  const [mtaCredentialId, setMtaCredentialId] = useState("");
  const [dnsProviderCredentialId, setDnsProviderCredentialId] = useState("");
  const [identityProviderCredentialId, setIdentityProviderCredentialId] = useState("");
  const [inboundMail, setInboundMail] = useState(true);
  const [sesSigning, setSesSigning] = useState(true);
  const [mtaSts, setMtaSts] = useState(true);
  const [dane, setDane] = useState(false);

  const [providerLabel, setProviderLabel] = useState("AWS production");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [hostedZoneId, setHostedZoneId] = useState("");
  const [configurationSetName, setConfigurationSetName] = useState("default-transactional");

  const dnsProviders = providers.data?.filter((p) => p.kind === "dns.route53") ?? [];
  const identityProviders = providers.data?.filter((p) => p.kind === "identity.ses") ?? [];

  const createProviders = useMutation({
    mutationFn: async () => {
      const dns = await orpc.providers.create({
        kind: "dns.route53",
        label: `${providerLabel} Route53`,
        accessKeyId,
        secretAccessKey,
        config: hostedZoneId ? { hostedZoneId } : {},
      });
      const ses = await orpc.providers.create({
        kind: "identity.ses",
        label: `${providerLabel} SES`,
        accessKeyId,
        secretAccessKey,
        config: { region: "eu-central-1", configurationSetName },
      });
      return { dns, ses };
    },
    onSuccess: ({ dns, ses }) => {
      queryClient.invalidateQueries({ queryKey: orpcQuery.providers.list.key() });
      setDnsProviderCredentialId(dns.id);
      setIdentityProviderCredentialId(ses.id);
      setAccessKeyId("");
      setSecretAccessKey("");
    },
  });

  const createPlan = useMutation({
    mutationFn: async () =>
      orpc.domains.createPlan({
        domain,
        mtaCredentialId,
        dnsProviderCredentialId,
        identityProviderCredentialId: sesSigning ? identityProviderCredentialId : undefined,
        options: { inboundMail, sesSigning, mtaSts, dane },
      }),
    onSuccess: (plan) => {
      router.navigate({ to: "/domain-plans/$planId", params: { planId: plan.id } });
    },
  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Provision domain</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              createPlan.mutate();
            }}
          >
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Domain">
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} required />
              </Field>
              <Field label="MTA credential">
                <select
                  className="h-10 rounded-md border border-[color:var(--color-border)] bg-transparent px-3 text-sm"
                  value={mtaCredentialId}
                  onChange={(e) => setMtaCredentialId(e.target.value)}
                  required
                >
                  <option value="">Select MTA</option>
                  {credentials.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="DNS provider">
                <select
                  className="h-10 rounded-md border border-[color:var(--color-border)] bg-transparent px-3 text-sm"
                  value={dnsProviderCredentialId}
                  onChange={(e) => setDnsProviderCredentialId(e.target.value)}
                  required
                >
                  <option value="">Select Route53 provider</option>
                  {dnsProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Identity provider">
                <select
                  className="h-10 rounded-md border border-[color:var(--color-border)] bg-transparent px-3 text-sm"
                  value={identityProviderCredentialId}
                  onChange={(e) => setIdentityProviderCredentialId(e.target.value)}
                  required={sesSigning}
                >
                  <option value="">Select SES provider</option>
                  {identityProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid md:grid-cols-4 gap-3 text-sm">
              <Toggle label="Inbound mail" checked={inboundMail} onChange={setInboundMail} />
              <Toggle label="SES signing" checked={sesSigning} onChange={setSesSigning} />
              <Toggle label="MTA-STS" checked={mtaSts} onChange={setMtaSts} />
              <Toggle label="DANE" checked={dane} onChange={setDane} />
            </div>

            {createPlan.error ? (
              <p className="text-sm text-[color:var(--color-danger)]">
                {(createPlan.error as Error).message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.navigate({ to: "/domains" })}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createPlan.isPending}>
                {createPlan.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Build plan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add AWS provider credentials</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Label">
              <Input value={providerLabel} onChange={(e) => setProviderLabel(e.target.value)} />
            </Field>
            <Field label="Hosted zone id (optional)">
              <Input value={hostedZoneId} onChange={(e) => setHostedZoneId(e.target.value)} />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Access key id">
              <Input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
            </Field>
            <Field label="Secret access key">
              <Input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
              />
            </Field>
          </div>
          <Field label="SES configuration set">
            <Input
              value={configurationSetName}
              onChange={(e) => setConfigurationSetName(e.target.value)}
            />
          </Field>
          {createProviders.error ? (
            <p className="text-sm text-[color:var(--color-danger)]">
              {(createProviders.error as Error).message}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={createProviders.isPending || !accessKeyId || !secretAccessKey}
              onClick={() => createProviders.mutate()}
            >
              <Plus className="size-4" /> Add Route53 + SES providers
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-3 py-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
