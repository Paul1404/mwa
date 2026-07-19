import { afterEach, describe, expect, it, vi } from "vitest";
import { MailcowProvider } from "./mailcow.server";

describe("MailcowProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a missing domain as discoverable state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MailcowProvider({
      apiUrl: "https://mail.example.com/api/",
      apiKey: "test-key",
    });

    await expect(provider.getDomain("example.com")).resolves.toEqual({
      exists: false,
      domain: "example.com",
      dkimSelectors: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://mail.example.com/api/v1/get/domain/example.com",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("still rejects unexpected Mailcow failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    const provider = new MailcowProvider({
      apiUrl: "https://mail.example.com",
      apiKey: "test-key",
    });

    await expect(provider.getDomain("example.com")).rejects.toThrow(
      "mailcow API /api/v1/get/domain/example.com failed with HTTP 500",
    );
  });

  it("normalizes quarantine rows without exposing arbitrary API fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            id: 4046,
            qid: "8B919435930E",
            sender: "sender@example.com",
            rcpt: "recipient@example.com",
            subject: "Review me",
            score: "8.77",
            action: "add header",
            virus_flag: "0",
            notified: "1",
            created: 1784455905,
            msg: "must not leak through list",
          },
        ]),
      ),
    );
    const provider = new MailcowProvider({
      apiUrl: "https://mail.example.com",
      apiKey: "test-key",
    });

    await expect(provider.listQuarantine()).resolves.toEqual([
      {
        id: "4046",
        queueId: "8B919435930E",
        sender: "sender@example.com",
        recipient: "recipient@example.com",
        subject: "Review me",
        score: 8.77,
        rspamdAction: "add header",
        virus: false,
        notified: true,
        createdAt: "2026-07-19T10:11:45.000Z",
      },
    ]);
  });

  it("uses the exact Mailcow quarantine action payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json([{ type: "success" }])));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MailcowProvider({
      apiUrl: "https://mail.example.com/api/v1",
      apiKey: "test-key",
    });

    await provider.performQuarantineAction("release", ["41", "42"]);
    await provider.performQuarantineAction("learn_spam", ["43"]);
    await provider.performQuarantineAction("delete", ["44"]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://mail.example.com/api/v1/edit/qitem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items: ["41", "42"], attr: { action: "release" } }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://mail.example.com/api/v1/edit/qitem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items: ["43"], attr: { action: "learnspam" } }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://mail.example.com/api/v1/delete/qitem",
      expect.objectContaining({ method: "POST", body: JSON.stringify(["44"]) }),
    );
  });
});
