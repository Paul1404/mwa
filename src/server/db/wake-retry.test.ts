import { describe, expect, it, vi } from "vitest";
import { isTransientDatabaseWakeError, retryDatabaseWake } from "./wake-retry";

describe("isTransientDatabaseWakeError", () => {
  it.each(["ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT", "57P03"])(
    "accepts transient connection code %s",
    (code) => {
      expect(isTransientDatabaseWakeError(Object.assign(new Error("unavailable"), { code }))).toBe(
        true,
      );
    },
  );

  it("finds a transient error nested in an aggregate", () => {
    const error = new AggregateError([
      Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }),
    ]);
    expect(isTransientDatabaseWakeError(error)).toBe(true);
  });

  it("rejects SQL and authentication failures", () => {
    expect(
      isTransientDatabaseWakeError(Object.assign(new Error("duplicate key"), { code: "23505" })),
    ).toBe(false);
    expect(
      isTransientDatabaseWakeError(
        Object.assign(new Error("password authentication failed"), { code: "28P01" }),
      ),
    ).toBe(false);
  });
});

describe("retryDatabaseWake", () => {
  it("retries a transient wake failure and then succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))
      .mockResolvedValue("ready");

    await expect(
      retryDatabaseWake(operation, { initialDelayMs: 0, maxDelayMs: 0, maxAttempts: 3 }),
    ).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-connection failures", async () => {
    const error = Object.assign(new Error("duplicate key"), { code: "23505" });
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(
      retryDatabaseWake(operation, { initialDelayMs: 0, maxDelayMs: 0, maxAttempts: 3 }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured attempt limit", async () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(
      retryDatabaseWake(operation, { initialDelayMs: 0, maxDelayMs: 0, maxAttempts: 3 }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
