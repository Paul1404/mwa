import { db, schema } from "./db";

export type AuditAction =
  | "credential.create"
  | "credential.update"
  | "credential.delete"
  | "credential.host_key.pinned"
  | "credential.host_key.changed"
  | "run.start"
  | "run.cancel"
  | "run.complete";

export type AuditTargetType = "credential" | "run";

export type AuditInput = {
  userId: string | null;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  metadata?: Record<string, unknown>;
  headers?: Headers;
};

function extractIp(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return headers.get("x-real-ip");
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.insert(schema.auditEvents).values({
      userId: input.userId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: extractIp(input.headers),
      userAgent: input.headers?.get("user-agent") ?? null,
    });
  } catch (err) {
    // Auditing must never break the user-facing flow. Log and move on.
    console.error("[audit] failed to record event", input.action, err);
  }
}
