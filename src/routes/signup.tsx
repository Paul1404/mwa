import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { getServerSession } from "~/lib/auth-session";

export const Route = createFileRoute("/signup")({
  beforeLoad: async () => {
    const session = await getServerSession();
    if (session) throw redirect({ to: "/dashboard" });
  },
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await authClient.signUp.email({ email, password, name });
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? "sign up failed");
      return;
    }
    router.invalidate();
    router.navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>
            Sign-up is open until disabled by an admin. Use a long passphrase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p className="text-xs text-[color:var(--color-muted)]">Minimum 12 characters.</p>
            </div>
            {error ? <p className="text-sm text-[color:var(--color-danger)]">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </Button>
            <p className="text-xs text-[color:var(--color-muted)] text-center">
              Already registered?{" "}
              <Link to="/login" className="text-[color:var(--color-accent)] hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
