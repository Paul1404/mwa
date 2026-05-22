import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth/index.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => auth.handler(request),
    },
  },
});
