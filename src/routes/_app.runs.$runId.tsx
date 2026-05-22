import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleCheck, CircleX, Loader2, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, type TerminalLine } from "~/components/terminal";
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

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const seenSeqRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // Seed terminal from persisted logs once.
  useEffect(() => {
    if (!initial.data) return;
    setLines(
      initial.data.logs.map((l) => ({
        seq: l.seq,
        step: l.step,
        stream: l.stream,
        line: l.line,
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

  const stepGroups = useMemo(() => groupByStep(lines), [lines]);

  if (initial.isLoading)
    return <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>;
  if (initial.error)
    return (
      <p className="text-sm text-[color:var(--color-danger)]">{(initial.error as Error).message}</p>
    );
  if (!status) return null;

  const isLive = status.status === "running" || status.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="font-mono text-base">Run {runId.slice(0, 8)}</CardTitle>
            <StatusBanner status={status} />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
          <span>
            Started{" "}
            {initial.data?.run.startedAt
              ? new Date(initial.data.run.startedAt).toLocaleString()
              : "—"}
          </span>
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
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {STEP_ORDER.map((id) => {
          const group = stepGroups.get(id);
          const active = !!group && group.length > 0;
          return (
            <span
              key={id}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                active
                  ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]/40"
                  : "border-[color:var(--color-border)] text-[color:var(--color-muted)]"
              }`}
            >
              {STEP_LABELS[id]}
            </span>
          );
        })}
      </div>

      <Terminal lines={lines} />
    </div>
  );
}

const STEP_ORDER = [
  "init",
  "grafana_down",
  "mailcow_update",
  "grafana_up",
  "docker_prune",
] as const;

const STEP_LABELS: Record<string, string> = {
  init: "Connect",
  grafana_down: "Grafana down",
  mailcow_update: "Mailcow update",
  grafana_up: "Grafana up",
  docker_prune: "Docker prune",
};

function groupByStep(lines: TerminalLine[]) {
  const out = new Map<string, TerminalLine[]>();
  for (const l of lines) {
    const arr = out.get(l.step) ?? [];
    arr.push(l);
    out.set(l.step, arr);
  }
  return out;
}
