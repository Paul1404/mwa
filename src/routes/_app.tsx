import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppNav } from "~/components/nav";
import { getServerSession } from "~/lib/auth-session";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getServerSession();
    if (!session) {
      throw redirect({ to: "/login" });
    }
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  return (
    <div className="min-h-dvh flex flex-col">
      <AppNav email={session?.email} />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-8 w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
