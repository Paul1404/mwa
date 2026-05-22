import { createFileRoute, redirect } from "@tanstack/react-router";
import { getServerSession } from "~/lib/auth-session";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const session = await getServerSession();
    throw redirect({ to: session ? "/dashboard" : "/login" });
  },
});
