import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema";

const allowSignup = (process.env.ALLOW_SIGNUP ?? "true").toLowerCase() !== "false";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
    usePlural: true,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: !allowSignup,
    autoSignIn: true,
    minPasswordLength: 12,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  advanced: {
    cookiePrefix: "mwa",
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  // tanstack-start cookie integration MUST be the last plugin so it can
  // intercept Set-Cookie headers added by every other plugin.
  plugins: [tanstackStartCookies()],
});

export type Auth = typeof auth;
