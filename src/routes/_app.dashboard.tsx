import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { CircleCheck, CircleX, KeyRound, Loader2, Play, Plus, Server } from "lucide-react";
import { useState } from "react";
import { PreflightPanel } from "~/components/preflight-panel";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof CircleCheck }> = {
    success: {
      label: "success",
      cls: "text-[color:var(--color-success)] bg-[color:var(--color-success)]/10",
      Icon: CircleCheck,
    },
    failed: {
      label: "failed",
      cls: "text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10",
      Icon: CircleX,
    },
    canceled: {
      label: "canceled",
      cls: "text-[color:var(--color-muted)] bg-[color:var(--color-surface-2)]",
      Icon: CircleX,
    },
    running: {
      label: "running",
      cls: "text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]",
      Icon: Loader2,
    },
    pending: {
      label: "pending",
      cls: "text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]",
      Icon: Loader2,
    },
  };
  const entry = map[status] ?? {
    label: status,
    cls: "text-[color:var(--color-muted)] bg-[color:var(--color-surface-2)]",
    Icon: CircleCheck,
  };
  const { Icon } = entry;
  const spinning = status === "running" || status === "pending";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${entry.cls}`}
    >
      <Icon className={`size-3 ${spinning ? "animate-spin" : ""}`} />
      {entry.label}
    </span>
  );
}

function Dashboard() {
  const router = useRouter();
  const credentials = useQuery(orpcQuery.credentials.list.queryOptions());
  const runs = useQuery(orpcQuery.runs.list.queryOptions({ input: { limit: 10 } }));
  const active = useQuery({
    ...orpcQuery.runs.active.queryOptions(),
    refetchInterval: 5000,
  });
  const [planningId, setPlanningId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            Trigger Mailcow upgrades and review past runs.
          </p>
        </div>
        <Button onClick={() => router.navigate({ to: "/credentials/new" })}>
          <Plus className="size-4" /> Add credential
        </Button>
      </div>

      {active.data ? (
        <Card className="border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent-soft)]/30">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-[color:var(--color-accent)]" />
              <div>
                <div className="font-medium">An update is in progress</div>
                <div className="text-xs text-[color:var(--color-muted)]">
                  Watch live or come back when it&apos;s done.
                </div>
              </div>
            </div>
            <Link to="/runs/$runId" params={{ runId: active.data.runId }}>
              <Button size="sm">Open</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wide mb-3">
          Credentials
        </h2>
        {credentials.isLoading ? (
          <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>
        ) : credentials.data && credentials.data.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {credentials.data.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="size-4 text-[color:var(--color-accent)]" /> {c.label}
                  </CardTitle>
                  <CardDescription>
                    {c.username}@{c.host}:{c.port}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[color:var(--color-muted)] truncate">
                      {c.publicKeyFingerprint ?? "None"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Link to="/credentials/$id" params={{ id: c.id }}>
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      </Link>
                      {c.needsRekey ? (
                        <Link
                          to="/credentials/$id"
                          params={{ id: c.id }}
                          search={{ replaceKey: 1 }}
                        >
                          <Button size="sm">
                            <KeyRound className="size-3.5" /> Replace key
                          </Button>
                        </Link>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setPlanningId(c.id)}
                          disabled={!!active.data || planningId === c.id}
                        >
                          <Play className="size-3.5" /> Plan update
                        </Button>
                      )}
                    </div>
                  </div>
                  {c.needsRekey ? (
                    <div className="rounded-md border border-[color:var(--color-danger)]/50 bg-[color:var(--color-danger)]/10 p-3 text-xs flex items-start gap-2 text-[color:var(--color-danger)]">
                      <KeyRound className="size-3.5 mt-0.5 shrink-0" />
                      <span>
                        Stored secret can&apos;t be decrypted with the current ENCRYPTION_KEY.
                        Replace the key to recover this credential.
                      </span>
                    </div>
                  ) : null}
                  {planningId === c.id && !c.needsRekey ? (
                    <PreflightPanel
                      credentialId={c.id}
                      disabled={!!active.data}
                      onClose={() => setPlanningId(null)}
                      onStart={(runId) =>
                        router.navigate({ to: "/runs/$runId", params: { runId } })
                      }
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[color:var(--color-muted)]">
              No SSH credentials yet.{" "}
              <Link
                to="/credentials/new"
                className="text-[color:var(--color-accent)] hover:underline"
              >
                Add one
              </Link>{" "}
              to get started.
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wide mb-3">
          Recent runs
        </h2>
        {runs.data && runs.data.length > 0 ? (
          <Card>
            <ul className="divide-y divide-[color:var(--color-border)]">
              {runs.data.map((r) => (
                <li key={r.id} className="px-6 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Run {r.id.slice(0, 8)}</div>
                    <div className="text-xs text-[color:var(--color-muted)]">
                      {new Date(r.startedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={r.status} />
                    <Link to="/runs/$runId" params={{ runId: r.id }}>
                      <Button variant="ghost" size="sm">
                        Open
                      </Button>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[color:var(--color-muted)]">
              No runs yet. Trigger one from a credential above.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
