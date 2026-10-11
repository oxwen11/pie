import crypto from "node:crypto";

import { EffectSchemaToJsonSchemaConverter } from "@orpc/experimental-effect";
import { StandardJsonSchemaConverter } from "@orpc/json-schema";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { MCPHandler } from "orpc-mcp/fetch";

import { agentMcpSession } from "../pi/pie-mcp";
import type { RpcContext } from "../rpc/context";
import { router } from "../rpc/router";
import { bearerToken, tokensMatch } from "./auth";

export const MCP_PATH = "/mcp";

/**
 * `pie mcp` prints this bearer. It is derived from the daemon token, so it is
 * not that credential: it opens `/mcp` and nothing under `/api/`. A Pi process
 * gets its own token instead. Deriving this one keeps it off disk.
 */
export const deriveMcpToken = (daemonToken: string): string =>
  crypto.createHmac("sha256", daemonToken).update("pie-mcp-v1").digest("hex");

const handler = new MCPHandler(router, {
  serverInfo: { name: "pie", version: "0.0.1" },
  // Pie's contracts are Effect Schemas; Standard Schema vendors are the fallback.
  converters: [new EffectSchemaToJsonSchemaConverter(), new StandardJsonSchemaConverter()],
});

/**
 * `/mcp` is the oRPC router, filtered to procedures marked `mcp.tool()`.
 * `orpc-mcp` owns the protocol. Pie still refuses a browser Origin. A bearer
 * must be the derived MCP token (daemon only) or a token issued for one Pi process.
 */
export const handleMcp = (options: {
  readonly token: string | undefined;
  readonly context: RpcContext;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers.origin !== undefined) {
      return HttpServerResponse.text("Forbidden", { status: 403 });
    }
    const presented = bearerToken(request.headers.authorization);
    const derived = options.token !== undefined && tokensMatch(options.token, presented);
    // Only a per-process bearer is bound; the ref comes from the server's own
    // record of who it was issued to, never from the request.
    const mcpSession = derived ? undefined : agentMcpSession(presented);
    if (!derived && mcpSession === undefined) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.option);
    if (web._tag === "None") return HttpServerResponse.text("Bad Request", { status: 400 });
    const handled = yield* Effect.promise(() =>
      handler.handle(web.value, {
        context: mcpSession === undefined ? options.context : { ...options.context, mcpSession },
      }),
    );
    return handled.response === undefined
      ? HttpServerResponse.text("Not Found", { status: 404 })
      : HttpServerResponse.fromWeb(handled.response);
  });
