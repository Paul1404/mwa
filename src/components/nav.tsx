import { Link, useRouter } from "@tanstack/react-router";
import { LogOut, Server, Terminal } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button } from "./ui/button";

export function AppNav({ email }: { email: string | undefined }) {
  const router = useRouter();
  async function handleSignOut() {
    await authClient.signOut();
    router.invalidate();
    router.navigate({ to: "/login" });
  }
  return (
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <Terminal className="size-4 text-[color:var(--color-accent)]" />
            <span>MWA</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/dashboard"
              className="px-3 py-1.5 rounded-md text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] [&.active]:text-[color:var(--color-text)] [&.active]:bg-[color:var(--color-surface-2)]"
              activeOptions={{ exact: true }}
            >
              Dashboard
            </Link>
            <Link
              to="/credentials"
              className="px-3 py-1.5 rounded-md text-[color:var(--color-muted)] hover:text-[color:var(--color-text)] [&.active]:text-[color:var(--color-text)] [&.active]:bg-[color:var(--color-surface-2)] flex items-center gap-2"
            >
              <Server className="size-3.5" />
              Credentials
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email ? <span className="text-xs text-[color:var(--color-muted)]">{email}</span> : null}
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
