import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // baseURL is inferred from window.location on the browser; we only need
  // to set it explicitly during SSR.
  baseURL: typeof window !== "undefined" ? undefined : process.env.BETTER_AUTH_URL,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
