// Runtime migration entry. drizzle-kit is a dev dependency so we cannot
// invoke it in production. Instead we use drizzle-orm's lightweight migrator
// which only needs the generated SQL files in ./drizzle.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] applied successfully");
} catch (err) {
  console.error("[migrate] failed", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
