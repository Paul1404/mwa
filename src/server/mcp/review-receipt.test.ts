import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createReviewReceipt,
  REVIEW_RECEIPT_TTL_MS,
  verifyReviewReceipt,
} from "./review-receipt.server";

describe("MCP quarantine review receipts", () => {
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const subject = {
    tokenId: "token-1",
    credentialId: "credential-1",
    itemId: "42",
    queueId: "queue-42",
  };

  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "test-review-receipt-secret";
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
  });

  it("accepts a fresh receipt for the inspected item and token", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const review = createReviewReceipt(subject, now);

    expect(review.reviewedAt).toBe("2026-07-19T12:00:00.000Z");
    expect(verifyReviewReceipt(review.receipt, subject, now + 1)).toBe(true);
  });

  it("rejects a receipt for another item, token, or credential", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const { receipt } = createReviewReceipt(subject, now);

    expect(verifyReviewReceipt(receipt, { ...subject, itemId: "43" }, now + 1)).toBe(false);
    expect(verifyReviewReceipt(receipt, { ...subject, tokenId: "token-2" }, now + 1)).toBe(false);
    expect(
      verifyReviewReceipt(receipt, { ...subject, credentialId: "credential-2" }, now + 1),
    ).toBe(false);
  });

  it("rejects expired and tampered receipts", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const { receipt } = createReviewReceipt(subject, now);
    const [payload, signature] = receipt.split(".");
    const tamperedPayload = `${payload!.startsWith("A") ? "B" : "A"}${payload!.slice(1)}`;

    expect(verifyReviewReceipt(receipt, subject, now + REVIEW_RECEIPT_TTL_MS)).toBe(false);
    expect(verifyReviewReceipt(`${tamperedPayload}.${signature}`, subject, now + 1)).toBe(false);
  });
});
