import postgres from "postgres";
import { retryDatabaseWake } from "./wake-retry";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. On Railway it is auto-provided by the Postgres plugin.",
  );
}

// This deliberately closes while idle. A permanently open pool would emit
// outbound traffic and stop Railway Serverless from putting the service to sleep.
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
  connect_timeout: 10,
});

const READY_CACHE_MS = 15_000;
let readyUntil = 0;
let wakePromise: Promise<void> | null = null;

export function waitForDatabaseWake(): Promise<void> {
  if (Date.now() < readyUntil) return Promise.resolve();
  if (wakePromise) return wakePromise;

  let reportedWake = false;
  wakePromise = retryDatabaseWake(
    async () => {
      await sql`select 1`;
    },
    {
      onRetry: () => {
        if (reportedWake) return;
        reportedWake = true;
        console.info("[database] waiting for serverless Postgres to wake");
      },
    },
  )
    .then(() => {
      readyUntil = Date.now() + READY_CACHE_MS;
      if (reportedWake) console.info("[database] serverless Postgres is ready");
    })
    .finally(() => {
      wakePromise = null;
    });

  return wakePromise;
}
