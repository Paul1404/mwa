import { CheckCircle2, ChevronRight, CircleX, Clock, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Terminal, type TerminalLine } from "~/components/terminal";

const STEP_ORDER = ["init", "mailcow_update", "docker_prune"] as const;

const STEP_LABELS: Record<string, string> = {
  init: "Connect",
  mailcow_update: "Mailcow update",
  docker_prune: "Docker prune",
};

type StepState = "pending" | "running" | "done" | "failed";

export type StepLine = TerminalLine & { at?: string };

type StepInfo = {
  id: string;
  label: string;
  lines: StepLine[];
  state: StepState;
  startedAt: number | null;
  finishedAt: number | null;
  etaMs?: number;
};

function computeSteps(
  lines: StepLine[],
  runStatus: string,
  etaByStep: Map<string, number>,
  stepOrder: readonly string[],
  stepLabels: Record<string, string>,
): StepInfo[] {
  const byStep = new Map<string, StepLine[]>();
  for (const l of lines) {
    const arr = byStep.get(l.step) ?? [];
    arr.push(l);
    byStep.set(l.step, arr);
  }

  // The current step is the latest one with any logs. Steps before it that
  // have logs are considered done; steps after it are pending.
  let lastStepWithLogs = -1;
  stepOrder.forEach((id, i) => {
    if ((byStep.get(id)?.length ?? 0) > 0) lastStepWithLogs = i;
  });

  const runDone = runStatus === "success" || runStatus === "failed" || runStatus === "canceled";
  const runFailed = runStatus === "failed" || runStatus === "canceled";

  return stepOrder.map((id, i) => {
    const stepLines = byStep.get(id) ?? [];
    const hasLogs = stepLines.length > 0;
    const isLast = i === lastStepWithLogs;

    let state: StepState;
    if (!hasLogs) state = "pending";
    else if (isLast && !runDone) state = "running";
    else if (isLast && runFailed) state = "failed";
    else state = "done";

    // Detect a per-step failure: the runner emits "step failed with exit code N".
    if (state !== "running" && stepLines.some((l) => l.line.startsWith("step failed"))) {
      state = "failed";
    }

    const firstWithAt = stepLines.find((l) => l.at);
    const lastWithAt = [...stepLines].reverse().find((l) => l.at);
    const startedAt = firstWithAt?.at ? new Date(firstWithAt.at).getTime() : null;
    const finishedAt =
      state === "done" || state === "failed"
        ? lastWithAt?.at
          ? new Date(lastWithAt.at).getTime()
          : null
        : null;

    return {
      id,
      label: stepLabels[id] ?? id,
      lines: stepLines,
      state,
      startedAt,
      finishedAt,
      etaMs: etaByStep.get(id),
    };
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return <CheckCircle2 className="size-4 text-[color:var(--color-success)]" />;
    case "failed":
      return <CircleX className="size-4 text-[color:var(--color-danger)]" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-[color:var(--color-accent)]" />;
    default:
      return (
        <span className="size-4 inline-block rounded-full border border-[color:var(--color-border)]" />
      );
  }
}

function StepRow({
  step,
  expanded,
  onToggle,
  now,
}: {
  step: StepInfo;
  expanded: boolean;
  onToggle: () => void;
  now: number;
}) {
  let duration: string | null = null;
  if (step.state === "running" && step.startedAt) {
    duration = formatDuration(now - step.startedAt);
  } else if (step.startedAt && step.finishedAt) {
    duration = formatDuration(step.finishedAt - step.startedAt);
  }

  return (
    <div className="border border-[color:var(--color-border)] rounded-md bg-[color:var(--color-surface)]/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-[color:var(--color-surface-2)]/40 transition-colors"
      >
        <ChevronRight
          className={`size-3.5 text-[color:var(--color-muted)] transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <StepIcon state={step.state} />
        <span className="text-sm font-medium flex-1">{step.label}</span>
        {duration ? (
          <span className="text-xs font-mono text-[color:var(--color-muted)]">{duration}</span>
        ) : step.etaMs ? (
          <span className="text-xs text-[color:var(--color-muted)] inline-flex items-center gap-1">
            <Clock className="size-3" />~{formatDuration(step.etaMs)}
          </span>
        ) : null}
      </button>
      {expanded && step.lines.length > 0 ? (
        <div className="border-t border-[color:var(--color-border)]">
          <Terminal lines={step.lines} autoscroll={step.state === "running"} />
        </div>
      ) : null}
    </div>
  );
}

export function RunSteps({
  lines,
  runStatus,
  stepEtaMs,
  now,
  stepOrder = STEP_ORDER,
  stepLabels = STEP_LABELS,
}: {
  lines: StepLine[];
  runStatus: string;
  stepEtaMs?: Record<string, number>;
  now: number;
  stepOrder?: readonly string[];
  stepLabels?: Record<string, string>;
}) {
  const etaMap = useMemo(() => new Map(Object.entries(stepEtaMs ?? {})), [stepEtaMs]);
  const steps = useMemo(
    () => computeSteps(lines, runStatus, etaMap, stepOrder, stepLabels),
    [lines, runStatus, etaMap, stepOrder, stepLabels],
  );

  // Expand the current step by default; collapse done ones.
  const [explicitExpanded, setExplicitExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (s: StepInfo) => {
    if (s.id in explicitExpanded) return explicitExpanded[s.id]!;
    return s.state === "running" || s.state === "failed";
  };

  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => (
        <StepRow
          key={s.id}
          step={s}
          expanded={isExpanded(s)}
          onToggle={() => setExplicitExpanded((prev) => ({ ...prev, [s.id]: !isExpanded(s) }))}
          now={now}
        />
      ))}
    </div>
  );
}
