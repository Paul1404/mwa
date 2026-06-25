import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellOff, CircleCheck, CircleX, Loader2, StopCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RunSteps, type StepLine } from "~/components/run-steps";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/domain-runs/$runId")({
  component: DomainRunPage,
});

const STEP_ORDER = [
  "init",
  "mailcow_domain",
  "ses_identity",
  "dns_changes",
  "dkim_cleanup",
  "verification",
];
const STEP_LABELS: Record<string, string> = {
  init: "Connect/config",
  mailcow_domain: "mailcow domain",
  ses_identity: "SES identity",
  dns_changes: "DNS changes",
  dkim_cleanup: "DKIM cleanup",
  verification: "Verification",
};

type LiveStatus = {
  status: string;
  errorMessage: string | null;
  finishedAt: string | null;
};

function DomainRunPage() {
  const { runId } = Route.useParams();
  const queryClient = useQueryClient();
  const initial = useQuery(orpcQuery.domains.getRun.queryOptions({ input: { id: runId } }));
  const [lines, setLines] = useState<StepLine[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [notify, setNotify] = useState(false);
  const seenSeqRef = useRef(0);

  useEffect(() => {
    if (!initial.data) return;
    setLines(
      initial.data.logs.map((l) => ({
        seq: l.seq,
        step: l.step,
        stream: l.stream,
        line: l.line,
        at: l.emittedAt,
      })),
    );
    seenSeqRef.current = initial.data.logs.length
      ? initial.data.logs[initial.data.logs.length - 1]!.seq
      : 0;
    setStatus({
      status: initial.data.run.status,
      errorMessage: initial.data.run.errorMessage,
      finishedAt: initial.data.run.finishedAt,
    });
  }, [initial.data]);

  const isLive = status?.status === "running" || status?.status === "pending";
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  useEffect(() => {
    if (!initial.data || !isLive) return;
    const ac = new AbortController();
    (async () => {
      try {
        const iter = await orpc.domains.streamRun(
          { id: runId, fromSeq: seenSeqRef.current },
          { signal: ac.signal },
        );
        for await (const ev of iter as AsyncIterable<Record<string, unknown>>) {
          if (ac.signal.aborted) return;
          if (ev.kind === "log") {
            const seq = Number(ev.seq);
            if (seq <= seenSeqRef.current) continue;
            seenSeqRef.current = seq;
            setLines((prev) => [
              ...prev,
              {
                seq,
                step: String(ev.step ?? ""),
                stream: String(ev.stream ?? "stdout"),
                line: String(ev.line ?? ""),
                at: ev.at == null ? undefined : String(ev.at),
              },
            ]);
          } else if (ev.kind === "status") {
            setStatus({
              status: String(ev.status),
              errorMessage: ev.errorMessage == null ? null : String(ev.errorMessage),
              finishedAt: ev.finishedAt == null ? null : String(ev.finishedAt),
            });
            queryClient.invalidateQueries({ queryKey: orpcQuery.domains.list.key() });
          }
        }
      } catch (err) {
        if (!ac.signal.aborted) console.warn("domain stream error", err);
      }
    })();
    return () => ac.abort();
  }, [initial.data, isLive, runId, queryClient]);

  const cancel = useMutation({ mutationFn: async () => orpc.domains.cancelRun({ id: runId }) });

  if (initial.isLoading)
    return <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>;
  if (initial.error || !status) {
    return (
      <p className="text-sm text-[color:var(--color-danger)]">{(initial.error as Error).message}</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="font-mono text-base">Domain run {runId.slice(0, 8)}</CardTitle>
            <StatusBanner status={status} />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
          <span>
            Started{" "}
            {initial.data?.run.startedAt
              ? new Date(initial.data.run.startedAt).toLocaleString()
              : "Not started"}
          </span>
          <div className="flex items-center gap-2">
            {isLive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotify((v) => !v)}
                title={notify ? "Notifications enabled" : "Notify me when this finishes"}
              >
                {notify ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
              </Button>
            ) : null}
            {isLive ? (
              <Button variant="danger" size="sm" onClick={() => cancel.mutate()}>
                <StopCircle className="size-3.5" /> Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <RunSteps
        lines={lines}
        runStatus={status.status}
        now={now}
        stepOrder={STEP_ORDER}
        stepLabels={STEP_LABELS}
      />
    </div>
  );
}

function StatusBanner({ status }: { status: LiveStatus }) {
  const done =
    status.status === "success" || status.status === "failed" || status.status === "canceled";
  const Icon = status.status === "success" ? CircleCheck : done ? CircleX : Loader2;
  const color =
    status.status === "success"
      ? "text-[color:var(--color-success)]"
      : status.status === "failed"
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-accent)]";
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`size-4 ${color} ${!done ? "animate-spin" : ""}`} />
      <span className="font-medium capitalize">{status.status}</span>
      {status.errorMessage ? (
        <span className="text-xs text-[color:var(--color-danger)]">{status.errorMessage}</span>
      ) : null}
    </div>
  );
}
