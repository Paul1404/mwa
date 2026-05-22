import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Server } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { orpcQuery } from "~/lib/orpc";

export const Route = createFileRoute("/_app/credentials/")({
  component: CredentialsPage,
});

function CredentialsPage() {
  const credentials = useQuery(orpcQuery.credentials.list.queryOptions());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            SSH keys are encrypted at rest with AES-256-GCM. They are never returned from the API.
          </p>
        </div>
        <Link to="/credentials/new">
          <Button>
            <Plus className="size-4" /> Add credential
          </Button>
        </Link>
      </div>

      {credentials.isLoading ? (
        <p className="text-sm text-[color:var(--color-muted)]">Loading...</p>
      ) : credentials.data && credentials.data.length > 0 ? (
        <Card>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {credentials.data.map((c) => (
              <li key={c.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Server className="size-4 text-[color:var(--color-accent)] shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-[color:var(--color-muted)] truncate">
                      {c.username}@{c.host}:{c.port}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden md:block text-xs text-[color:var(--color-muted)] font-mono truncate max-w-xs">
                    {c.publicKeyFingerprint ?? "—"}
                  </span>
                  <Link to="/credentials/$id" params={{ id: c.id }}>
                    <Button variant="secondary" size="sm">
                      Manage
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <Server className="size-8 mx-auto text-[color:var(--color-muted)]" />
            <p className="mt-3 text-sm text-[color:var(--color-muted)]">
              No credentials configured yet.
            </p>
            <Link to="/credentials/new" className="mt-4 inline-block">
              <Button>Add your first credential</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
