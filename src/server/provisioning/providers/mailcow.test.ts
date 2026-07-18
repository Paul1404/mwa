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
      apiUrl: "https://mail.example.com",
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
});
