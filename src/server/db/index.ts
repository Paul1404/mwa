import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. On Railway it is auto-provided by the Postgres plugin.",
  );
}

// One connection pool per process. Drizzle reuses this across all queries.
// `prepare: false` keeps things safe with PgBouncer-style poolers like Railway's.
const queryClient = postgres(databaseUrl, {
  max: 10,
  prepare: false,
  idle_timeout: 30,
});

export const db = drizzle(queryClient, { schema });
export { schema };
export type Db = typeof db;
