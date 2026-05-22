import { RPCHandler } from "@orpc/server/fetch";
import { createContext } from "./context.server";
import { appRouter } from "./router.server";

const handler = new RPCHandler(appRouter);

export const RPC_PREFIX = "/api/rpc";

export async function handleRpc(request: Request): Promise<Response> {
  const context = await createContext(request);
  const result = await handler.handle(request, {
    prefix: RPC_PREFIX,
    context,
  });
  if (!result.matched) {
    return new Response("not found", { status: 404 });
  }
  return result.response;
}
