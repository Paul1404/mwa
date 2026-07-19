import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  return {
    audit: vi.fn(),
    insert: vi.fn(() => ({ values })),
    listQuarantine: vi.fn(),
    returning,
    values,
  };
});

vi.mock("../audit.server", () => ({ audit: mocks.audit }));
vi.mock("../db", () => ({
  db: { insert: mocks.insert },
  schema: { quarantineActionPlans: {} },
}));
vi.mock("../provisioning/provider-factory.server", () => ({
  createMailcowProvider: () => ({ listQuarantine: mocks.listQuarantine }),
}));

import { planQuarantineAction } from "./quarantine.server";
import { createReviewReceipt } from "./review-receipt.server";

describe("MCP quarantine review enforcement", () => {
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const auth = {
    token: { id: "token-1", scope: "manage", createdBy: "user-1", label: "agent" },
    credential: { id: "credential-1" },
    headers: new Headers(),
  };
  const item = {
    id: "42",
    queueId: "queue-42",
    sender: "sender@example.com",
    recipient: "recipient@example.com",
    subject: "Test",
    score: 12,
    rspamdAction: "reject",
    virus: false,
    notified: false,
    createdAt: "2026-07-19T12:00:00.000Z",
  };

  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "test-review-receipt-secret";
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listQuarantine.mockResolvedValue([item]);
    mocks.returning.mockResolvedValue([
      { id: "00000000-0000-4000-8000-000000000042", action: "delete", reason: "spam" },
    ]);
  });

  it("rejects action planning when the message was not inspected", async () => {
    await expect(
      planQuarantineAction(auth as never, {
        action: "delete",
        reviews: [{ id: item.id, receipt: "not-a-valid-review-receipt" }],
        reason: "spam",
      }),
    ).rejects.toThrow("require a fresh inspection");

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("accepts a fresh receipt from the same token for the exact message", async () => {
    const review = createReviewReceipt({
      tokenId: auth.token.id,
      credentialId: auth.credential.id,
      itemId: item.id,
      queueId: item.queueId,
    });

    const plan = await planQuarantineAction(auth as never, {
      action: "delete",
      reviews: [{ id: item.id, receipt: review.receipt }],
      reason: "Reviewed message is spam",
    });

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", itemIds: [item.id] }),
    );
    expect(plan.reviewStatus).toContain("individually inspected");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reviewProofsValidated: true }),
      }),
    );
  });
});
