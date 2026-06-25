import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Globe2, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/domains/")({
  component: DomainsPage,
});

function DomainsPage() {
  const router = useRouter();
  const domains = useQuery(orpcQuery.domains.list.queryOptions());
  const providers = useQuery(orpcQuery.providers.list.queryOptions());

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Domains</h1>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            Provision mail domains across DNS, SES, and mailcow.
          </p>
        </div>
        <Button onClick={() => router.navigate({ to: "/domains/new" })}>
          <Plus className="size-4" /> New domain
        </Button>
      </div>

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wide mb-3">
          Provider credentials
        </h2>
        <Card>
          <CardContent className="py-4">
            {providers.data && providers.data.length > 0 ? (
              <ul className="divide-y divide-[color:var(--color-border)]">
                {providers.data.map((p) => (
                  <li key={p.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-[color:var(--color-muted)]">{p.kind}</div>
                    </div>
                    <span className="text-xs font-mono text-[color:var(--color-muted)]">
                      {String((p.config as Record<string, unknown>).region ?? "")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[color:var(--color-muted)]">
                No provider credentials yet. Add them while creating a domain.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wide mb-3">
          Onboarded domains
        </h2>
        {domains.data && domains.data.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {domains.data.map((d) => (
              <Card key={d.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe2 className="size-4 text-[color:var(--color-accent)]" /> {d.domain}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between text-sm">
                  <span className="capitalize text-[color:var(--color-muted)]">{d.status}</span>
                  {d.lastRunId ? (
                    <Link to="/domain-runs/$runId" params={{ runId: d.lastRunId }}>
                      <Button variant="ghost" size="sm">
                        Last run
                      </Button>
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[color:var(--color-muted)]">
              No provisioned domains yet.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
