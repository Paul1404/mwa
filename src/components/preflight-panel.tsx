import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info, KeyRound, Loader2, Play, ShieldAlert, X, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { orpc, orpcQuery } from "~/lib/orpc";

type CheckStatus = "ok" | "warn" | "fail" | "info";

type Check = {
  id: string;
  label: string;
  value: string;
  status: CheckStatus;
  detail?: string;
};

const STATUS_STYLE: Record<
  CheckStatus,
  { icon: ComponentType<{ className?: string }>; color: string }
> = {
  ok: { icon: CheckCircle2, color: "text-[color:var(--color-success)]" },
  warn: { icon: ShieldAlert, color: "text-amber-300" },
  fail: { icon: XCircle, color: "text-[color:var(--color-danger)]" },
  info: { icon: Info, color: "text-[color:var(--color-muted)]" },
};

function CheckRow({ check }: { check: Check }) {
  const { icon: Icon, color } = STATUS_STYLE[check.status];
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <Icon className={`size-4 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[color:var(--color-muted)]">{check.label}</span>
          <span className="font-mono text-xs text-[color:var(--color-text)] truncate">
            {check.value}
          </span>
        </div>
        {check.detail ? (
          <div className="text-xs text-[color:var(--color-muted)] mt-0.5">{check.detail}</div>
        ) : null}
      </div>
    </li>
  );
}

export function PreflightPanel({
  credentialId,
  onClose,
  onStart,
  disabled,
}: {
  credentialId: string;
  onClose: () => void;
  onStart: (runId: string) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  const preflight = useMutation({
    mutationFn: async () => orpc.runs.preflight({ id: credentialId }),
  });

  const trigger = useMutation({
    mutationFn: async () => orpc.runs.trigger({ id: credentialId }),
    onSuccess: ({ runId }) => {
      queryClient.invalidateQueries({ queryKey: orpcQuery.runs.list.key() });
      queryClient.invalidateQueries({ queryKey: orpcQuery.runs.active.key() });
      onStart(runId);
    },
  });

  // Kick off preflight on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    preflight.mutate();
  }, []);

  const report = preflight.data;
  const blocked = report?.hasBlockers ?? false;
  const warned = report?.hasWarnings ?? false;
  const confirmDisabled =
    disabled ||
    trigger.isPending ||
    preflight.isPending ||
    blocked ||
    (warned && !acknowledgeWarnings);

  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)]/40 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Pre-flight check</div>
          <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
            Connects over SSH and inspects the target before any changes are made.
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {preflight.isPending ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-muted)] py-4">
          <Loader2 className="size-4 animate-spin" /> Running checks...
        </div>
      ) : preflight.error ? (
        <div className="text-sm text-[color:var(--color-danger)]">
          {(preflight.error as Error).message}
        </div>
      ) : report ? (
        <>
          <div className="text-xs text-[color:var(--color-muted)] flex items-center gap-2">
            <KeyRound className="size-3.5" />
            <span className="font-mono break-all">{report.hostFingerprint}</span>
          </div>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {report.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>

          {blocked ? (
            <div className="rounded-md border border-[color:var(--color-danger)]/50 bg-[color:var(--color-danger)]/10 p-3 text-sm text-[color:var(--color-danger)]">
              One or more blockers prevent this update. Resolve them and re-run pre-flight.
            </div>
          ) : warned ? (
            <label className="flex items-start gap-2 text-sm text-[color:var(--color-muted)]">
              <input
                type="checkbox"
                checked={acknowledgeWarnings}
                onChange={(e) => setAcknowledgeWarnings(e.target.checked)}
                className="mt-1"
              />
              <span>I have reviewed the warnings and want to proceed anyway.</span>
            </label>
          ) : null}

          {trigger.error ? (
            <p className="text-sm text-[color:var(--color-danger)]">
              {(trigger.error as Error).message}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => preflight.mutate()}>
              Re-run checks
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => trigger.mutate()}
              disabled={confirmDisabled}
            >
              {trigger.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {trigger.isPending ? "Starting..." : "Confirm and start update"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
