import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, Play } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/domain-plans/$planId")({
  component: DomainPlanPage,
});

function DomainPlanPage() {
  const { planId } = Route.useParams();
  const router = useRouter();
  const plan = useQuery(orpcQuery.domains.getPlan.queryOptions({ input: { id: planId } }));
  const apply = useMutation({
    mutationFn: async () => orpc.domains.applyPlan({ id: planId }),
    onSuccess: ({ runId }) => {
      router.navigate({ to: "/domain-runs/$runId", params: { runId } });
    },
  });

  if (plan.isLoading) return <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>;
  if (plan.error || !plan.data) {
    return (
      <p className="text-sm text-[color:var(--color-danger)]">{(plan.error as Error).message}</p>
    );
  }

  const blockers = plan.data.blockers;
  const dkimDeletes = plan.data.changes.filter((c) => {
    const rec = c.record as { name?: string } | undefined;
    return c.action === "DELETE" && rec?.name?.includes("._domainkey.");
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Plan for {plan.data.domain}</CardTitle>
            <Button
              disabled={blockers.length > 0 || apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Apply plan
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {blockers.length > 0 ? (
            <Notice tone="danger" items={blockers} title="Blockers" />
          ) : (
            <div className="flex items-center gap-2 text-[color:var(--color-success)]">
              <CheckCircle2 className="size-4" /> No blockers
            </div>
          )}
          {plan.data.warnings.length > 0 ? (
            <Notice tone="warn" items={plan.data.warnings} title="Warnings" />
          ) : null}
          {dkimDeletes.length > 0 ? (
            <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-amber-200 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>
                SES signing is enabled. These non-SES DKIM records will be removed to avoid double
                signing.
              </span>
            </div>
          ) : null}
          {apply.error ? (
            <p className="text-[color:var(--color-danger)]">{(apply.error as Error).message}</p>
          ) : null}
        </CardContent>
      </Card>

      <ChangeGroup
        title="Creates"
        changes={plan.data.changes.filter((c) => c.action === "CREATE")}
      />
      <ChangeGroup
        title="Updates"
        changes={plan.data.changes.filter((c) => c.action === "UPSERT")}
      />
      <ChangeGroup
        title="Deletes"
        changes={plan.data.changes.filter(
          (c) => c.action === "DELETE" || c.action === "delete_dkim",
        )}
      />
      <ChangeGroup
        title="Provider actions"
        changes={plan.data.changes.filter(
          (c) => !["CREATE", "UPSERT", "DELETE", "delete_dkim"].includes(String(c.action)),
        )}
      />
    </div>
  );
}

function Notice({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "warn" | "danger";
}) {
  const cls =
    tone === "danger"
      ? "border-[color:var(--color-danger)]/50 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
      : "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="font-medium mb-1">{title}</div>
      <ul className="list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ChangeGroup({ title, changes }: { title: string; changes: Record<string, unknown>[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} <span className="text-[color:var(--color-muted)]">({changes.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {changes.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">None</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border)]">
            {changes.map((change) => (
              <li key={JSON.stringify(change)} className="py-3 text-sm">
                <div className="font-medium">{describeChange(change)}</div>
                <div className="text-xs text-[color:var(--color-muted)] mt-1">
                  {String(change.reason ?? "")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function describeChange(change: Record<string, unknown>) {
  const record = change.record as { name?: string; type?: string; values?: string[] } | undefined;
  if (record) return `${String(change.action)} ${record.type} ${record.name}`;
  if (change.provider === "mailcow" && change.action === "delete_dkim") {
    return `Delete mailcow DKIM selector ${String(change.selector)} for ${String(change.domain)}`;
  }
  return `${String(change.provider)}: ${String(change.action)}`;
}
