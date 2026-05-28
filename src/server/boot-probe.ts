// Boot-time encryption health check. Runs after migrations on every container
// start. Compares the active ENCRYPTION_KEY against the persisted canary, then
// scans every stored credential and logs a clear summary of how many can still
// be decrypted. Exits 0 even on key-mismatch -- this is purely diagnostic, the
// app needs to stay up so users can re-key.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CANARY_KEY, CANARY_PLAINTEXT, decrypt, encrypt } from "./crypto.server";
import * as schema from "./db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[boot-probe] DATABASE_URL is required");
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error("[boot-probe] ENCRYPTION_KEY is not set -- credentials cannot be decrypted");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

type CanaryState = "ok" | "rotated" | "missing";

async function checkCanary(): Promise<CanaryState> {
  const existing = await db.query.systemMetadata.findFirst({
    where: eq(schema.systemMetadata.key, CANARY_KEY),
  });

  if (!existing) {
    await db.insert(schema.systemMetadata).values({
      key: CANARY_KEY,
      value: encrypt(CANARY_PLAINTEXT),
    });
    return "missing";
  }

  try {
    const plain = decrypt(existing.value);
    if (plain !== CANARY_PLAINTEXT) return "rotated";
    return "ok";
  } catch {
    return "rotated";
  }
}

async function countUnreadableCredentials(): Promise<{ total: number; unreadable: number }> {
  const rows = await db
    .select({ enc: schema.sshCredentials.privateKeyEnc })
    .from(schema.sshCredentials);
  let unreadable = 0;
  for (const r of rows) {
    try {
      decrypt(r.enc);
    } catch {
      unreadable += 1;
    }
  }
  return { total: rows.length, unreadable };
}

try {
  const canary = await checkCanary();
  const { total, unreadable } = await countUnreadableCredentials();

  switch (canary) {
    case "ok":
      console.log(
        `[boot-probe] encryption key OK (canary verified, ${total - unreadable}/${total} credentials decrypt cleanly)`,
      );
      break;
    case "missing":
      console.log(
        `[boot-probe] encryption canary written for the first time (${total} credentials present)`,
      );
      break;
    case "rotated":
      console.warn(
        `[boot-probe] WARNING: ENCRYPTION_KEY appears to have changed since last boot. ${unreadable}/${total} stored credentials can no longer be decrypted. Users must re-enter their private keys via the "Replace key" UI.`,
      );
      // Re-seed the canary so subsequent boots agree with the new key.
      await db
        .update(schema.systemMetadata)
        .set({ value: encrypt(CANARY_PLAINTEXT), updatedAt: new Date() })
        .where(eq(schema.systemMetadata.key, CANARY_KEY));
      break;
  }
} catch (err) {
  console.error("[boot-probe] failed", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
