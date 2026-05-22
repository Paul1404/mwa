import { auth } from "../auth/index.server";

export type OrpcContext = {
  headers: Headers;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
  userId: string | null;
};

export async function createContext(req: Request): Promise<OrpcContext> {
  const session = await auth.api.getSession({ headers: req.headers });
  return {
    headers: req.headers,
    session,
    userId: session?.user.id ?? null,
  };
}
