import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "~/server/mcp/handler.server";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => handleMcp(request),
    },
  },
});
