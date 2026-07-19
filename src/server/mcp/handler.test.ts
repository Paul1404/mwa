import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listQuarantine: vi.fn().mockResolvedValue({ total: 0, matched: 0, items: [] }),
}));

vi.mock("./auth.server", () => ({
  authenticateMcpRequest: vi.fn(async (request: Request) =>
    request.headers.get("authorization") === "Bearer valid"
      ? {
          token: { id: "token-id", scope: "manage", createdBy: "user-id", label: "test" },
          credential: { id: "credential-id" },
          headers: request.headers,
        }
      : null,
  ),
  mcpUnauthorizedResponse: () => new Response("unauthorized", { status: 401 }),
}));

vi.mock("./quarantine.server", () => ({
  listQuarantine: mocks.listQuarantine,
  inspectQuarantineItem: vi.fn(),
  planQuarantineAction: vi.fn(),
  applyQuarantineAction: vi.fn(),
}));

import { handleMcp } from "./handler.server";

describe("MWA MCP transport", () => {
  const previousUrl = process.env.BETTER_AUTH_URL;

  beforeAll(() => {
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
  });

  afterAll(() => {
    if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousUrl;
  });

  it("rejects requests without an agent token", async () => {
    const response = await handleMcp(mcpRequest("initialize", initializeParams(), undefined));
    expect(response.status).toBe(401);
  });

  it("negotiates Streamable HTTP and exposes the quarantine tools", async () => {
    const initialize = await handleMcp(mcpRequest("initialize", initializeParams(), 1));
    if (!initialize.ok) throw new Error(`${initialize.status}: ${await initialize.clone().text()}`);
    expect(initialize.status).toBe(200);
    const initialized = await initialize.json();
    expect(initialized.result.serverInfo.name).toBe("mwa-mailcow");

    const tools = await handleMcp(mcpRequest("tools/list", {}, 2));
    expect(tools.status).toBe(200);
    const listed = await tools.json();
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "quarantine_list",
      "quarantine_inspect",
      "quarantine_plan_actions",
      "quarantine_apply_actions",
    ]);
    expect(listed.result.tools.at(-1).annotations.destructiveHint).toBe(true);
  });

  it("returns structured JSON from quarantine_list", async () => {
    const response = await handleMcp(
      mcpRequest("tools/call", { name: "quarantine_list", arguments: { limit: 10 } }, 3),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent).toEqual({ total: 0, matched: 0, items: [] });
    expect(mocks.listQuarantine).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ scope: "manage" }) }),
      expect.objectContaining({ limit: 10 }),
    );
  });
});

function mcpRequest(method: string, params: unknown, id: number | undefined): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      authorization: id === undefined ? "Bearer invalid" : "Bearer valid",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      host: "localhost:3000",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

function initializeParams() {
  return {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mwa-test", version: "1.0.0" },
  };
}
