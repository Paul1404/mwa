import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellOff, CircleCheck, CircleX, Clock, Loader2, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunSteps, type StepLine } from "~/components/run-steps";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc, orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/runs/$runId")({
  component: RunPage,
});

type LiveStatus = {
  status: string;
  exitCode: number | null;
  errorMessage: string | null;
  finishedAt: string | null;
};

function StatusBanner({ status }: { status: LiveStatus }) {
  const done =
    status.status === "success" || status.status === "failed" || status.status === "canceled";
  const Icon = status.status === "success" ? CircleCheck : done ? CircleX : Loader2;
  const color =
    status.status === "success"
      ? "text-[color:var(--color-success)]"
      : status.status === "failed"
        ? "text-[color:var(--color-danger)]"
        : status.status === "canceled"
          ? "text-[color:var(--color-muted)]"
          : "text-[color:var(--color-accent)]";
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`size-4 ${color} ${!done ? "animate-spin" : ""}`} />
      <span className="font-medium capitalize">{status.status}</span>
      {status.exitCode !== null ? (
        <span className="text-xs text-[color:var(--color-muted)]">exit {status.exitCode}</span>
      ) : null}
      {status.errorMessage ? (
        <span className="text-xs text-[color:var(--color-danger)]">{status.errorMessage}</span>
      ) : null}
    </div>
  );
}

function RunPage() {
  const { runId } = Route.useParams();
  const queryClient = useQueryClient();
  const initial = useQuery(orpcQuery.runs.get.queryOptions({ input: { id: runId } }));
  const stats = useQuery(orpcQuery.runs.stats.queryOptions({ input: {} }));

  const [lines, setLines] = useState<StepLine[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [notify, setNotify] = useState<boolean>(false);
  const seenSeqRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const notifiedRef = useRef<boolean>(false);

  // Seed terminal from persisted logs once.
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
      exitCode: initial.data.run.exitCode,
      errorMessage: initial.data.run.errorMessage,
      finishedAt: initial.data.run.finishedAt,
    });
  }, [initial.data]);

  // Tick a clock for live duration display while the run is active.
  const isLive = status?.status === "running" || status?.status === "pending";
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  // Browser notification on completion (only if the tab is not focused).
  useEffect(() => {
    if (!status || isLive || notifiedRef.current) return;
    if (!notify || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (document.hidden) {
      notifiedRef.current = true;
      const title =
        status.status === "success"
          ? "Mailcow update finished"
          : status.status === "failed"
            ? "Mailcow update failed"
            : "Mailcow update canceled";
      new Notification(title, {
        body: `Run ${runId.slice(0, 8)} ${status.status}`,
        tag: `mwa-run-${runId}`,
      });
    }
  }, [status, isLive, notify, runId]);

  // Stream live updates.
  useEffect(() => {
    if (!initial.data) return;
    if (
      initial.data.run.status === "success" ||
      initial.data.run.status === "failed" ||
      initial.data.run.status === "canceled"
    ) {
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      try {
        const iter = await orpc.runs.stream(
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
            const s: LiveStatus = {
              status: String(ev.status),
              exitCode: ev.exitCode == null ? null : Number(ev.exitCode),
              errorMessage: ev.errorMessage == null ? null : String(ev.errorMessage),
              finishedAt: ev.finishedAt == null ? null : String(ev.finishedAt),
            };
            setStatus(s);
            if (s.status !== "running" && s.status !== "pending") {
              queryClient.invalidateQueries({ queryKey: orpcQuery.runs.list.key() });
              queryClient.invalidateQueries({ queryKey: orpcQuery.runs.active.key() });
            }
          }
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          console.warn("stream error", err);
        }
      }
    })();
    return () => ac.abort();
  }, [initial.data, runId, queryClient]);

  const cancelMut = useMutation({
    mutationFn: async () => orpc.runs.cancel({ id: runId }),
  });

  const stepEtaMs = useMemo(() => {
    if (!stats.data) return undefined;
    const out: Record<string, number> = {};
    for (const s of stats.data.steps) out[s.step] = s.avgMs;
    return out;
  }, [stats.data]);

  const eta = useMemo(() => {
    if (!isLive || !stats.data?.totalAvgMs || !initial.data) return null;
    const elapsed = now - new Date(initial.data.run.startedAt).getTime();
    const remaining = stats.data.totalAvgMs - elapsed;
    return remaining > 0 ? remaining : null;
  }, [isLive, stats.data, initial.data, now]);

  const toggleNotify = async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm === "granted") setNotify(true);
      return;
    }
    setNotify((v) => !v);
  };

  if (initial.isLoading)
    return <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>;
  if (initial.error)
    return (
      <p className="text-sm text-[color:var(--color-danger)]">{(initial.error as Error).message}</p>
    );
  if (!status) return null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="font-mono text-base">Run {runId.slice(0, 8)}</CardTitle>
            <StatusBanner status={status} />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-xs text-[color:var(--color-muted)] gap-4 flex-wrap">
          <span>
            Started{" "}
            {initial.data?.run.startedAt
              ? new Date(initial.data.run.startedAt).toLocaleString()
              : "Not started"}
          </span>
          <div className="flex items-center gap-3">
            {isLive && eta !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />~{formatMs(eta)} left
              </span>
            ) : null}
            {isLive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleNotify}
                title={notify ? "Notifications enabled" : "Notify me when this finishes"}
              >
                {notify ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
              </Button>
            ) : null}
            {isLive ? (
              <Button
                variant="danger"
                size="sm"
                disabled={cancelMut.isPending}
                onClick={() => cancelMut.mutate()}
              >
                <StopCircle className="size-3.5" /> Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <RunSteps lines={lines} runStatus={status.status} stepEtaMs={stepEtaMs} now={now} />
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}
