import { createFileRoute } from "@tanstack/react-router";
import { handleRpc } from "~/server/orpc/handler.server";

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      ANY: ({ request }) => handleRpc(request),
    },
  },
});
