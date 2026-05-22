import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "~/server/auth/index.server";

/**
 * Server function that returns the current session (or null). Safe to call
 * from `beforeLoad` to gate routes on the server before the HTML ships.
 */
export const getServerSession = createServerFn({ method: "GET" }).handler(async () => {
  const req = getRequest();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
});
