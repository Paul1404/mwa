import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Pencil,
  PlayCircle,
  Plus,
  ScrollText,
  ShieldAlert,
  StopCircle,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/audit")({
  component: AuditPage,
});

type ActionMeta = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone: "info" | "warn" | "danger" | "success";
};

const ACTION_META: Record<string, ActionMeta> = {
  "credential.create": { icon: Plus, label: "Credential created", tone: "success" },
  "credential.update": { icon: Pencil, label: "Credential updated", tone: "info" },
  "credential.delete": { icon: Trash2, label: "Credential deleted", tone: "danger" },
  "credential.host_key.pinned": { icon: KeyRound, label: "Host key pinned", tone: "info" },
  "credential.host_key.changed": {
    icon: ShieldAlert,
    label: "Host key changed",
    tone: "warn",
  },
  "run.start": { icon: PlayCircle, label: "Run started", tone: "info" },
  "run.cancel": { icon: StopCircle, label: "Run canceled", tone: "warn" },
  "run.complete": { icon: ScrollText, label: "Run completed", tone: "success" },
  "mcp.token.create": { icon: KeyRound, label: "MCP token created", tone: "success" },
  "mcp.token.revoke": { icon: Trash2, label: "MCP token revoked", tone: "danger" },
  "quarantine.action.plan": { icon: Bot, label: "Quarantine action planned", tone: "info" },
  "quarantine.action.apply": {
    icon: CheckCircle2,
    label: "Quarantine action applied",
    tone: "success",
  },
  "quarantine.action.fail": {
    icon: ShieldAlert,
    label: "Quarantine action failed",
    tone: "danger",
  },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? {
    icon: ScrollText,
    label: action,
    tone: "info" as const,
  };
  const toneClass = {
    info: "text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]",
    success: "text-[color:var(--color-success)] bg-[color:var(--color-success)]/10",
    warn: "text-amber-300 bg-amber-300/10",
    danger: "text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10",
  }[meta.tone];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      <Icon className="size-3.5" />
      {meta.label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function MetadataSummary({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null;
  const parts: string[] = [];
  for (const [k, val] of Object.entries(metadata)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object") parts.push(`${k}=${JSON.stringify(val)}`);
    else parts.push(`${k}=${String(val)}`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="text-xs text-[color:var(--color-muted)] font-mono truncate">
      {parts.join("  ")}
    </div>
  );
}

function AuditPage() {
  const events = useQuery(orpcQuery.audit.list.queryOptions({ input: { limit: 100 } }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-[color:var(--color-muted)] mt-1">
          Recent credential, run, domain, MCP, and quarantine events. Showing the latest 100.
        </p>
      </div>

      {events.isLoading ? (
        <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>
      ) : events.data && events.data.length > 0 ? (
        <Card>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {events.data.map((e) => (
              <li key={e.id} className="px-6 py-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <ActionBadge action={e.action} />
                  <div className="text-xs text-[color:var(--color-muted)] shrink-0">
                    <span title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="text-[color:var(--color-muted)]">by </span>
                      <span className="font-medium">{e.userEmail ?? "system"}</span>
                      {e.ipAddress ? (
                        <span className="text-[color:var(--color-muted)]"> from {e.ipAddress}</span>
                      ) : null}
                    </div>
                    <MetadataSummary metadata={e.metadata} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <ScrollText className="size-8 mx-auto text-[color:var(--color-muted)]" />
            <p className="mt-3 text-sm text-[color:var(--color-muted)]">No audit events yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
