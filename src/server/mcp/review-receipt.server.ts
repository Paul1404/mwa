import { createHmac, timingSafeEqual } from "node:crypto";

export const REVIEW_RECEIPT_TTL_MS = 60 * 60 * 1000;

type ReviewSubject = {
  tokenId: string;
  credentialId: string;
  itemId: string;
  queueId: string | null;
};

type ReviewReceiptPayload = ReviewSubject & {
  version: 1;
  reviewedAt: number;
  expiresAt: number;
};

export function createReviewReceipt(subject: ReviewSubject, now = Date.now()) {
  const payload: ReviewReceiptPayload = {
    version: 1,
    ...subject,
    reviewedAt: now,
    expiresAt: now + REVIEW_RECEIPT_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    receipt: `${encoded}.${sign(encoded)}`,
    reviewedAt: new Date(payload.reviewedAt).toISOString(),
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export function verifyReviewReceipt(
  receipt: string,
  subject: ReviewSubject,
  now = Date.now(),
): boolean {
  const [encoded, signature, extra] = receipt.split(".");
  if (!encoded || !signature || extra) return false;
  const expectedSignature = sign(encoded);
  const actualBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<ReviewReceiptPayload>;
    return (
      payload.version === 1 &&
      payload.tokenId === subject.tokenId &&
      payload.credentialId === subject.credentialId &&
      payload.itemId === subject.itemId &&
      payload.queueId === subject.queueId &&
      typeof payload.reviewedAt === "number" &&
      typeof payload.expiresAt === "number" &&
      payload.reviewedAt <= now &&
      payload.expiresAt > now
    );
  } catch {
    return false;
  }
}

function sign(encoded: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for MCP review receipts");
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}
