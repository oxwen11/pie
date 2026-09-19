import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { PLUGIN_URL_PREFIX, resolvePluginFile } from "../plugin";
import type { ServedUI, UIApp } from "./ui";

const notFound = HttpServerResponse.text("Not Found", { status: 404 });

/**
 * Serve `$PIE_HOME/plugins/<id>/…` at `/plugins/<id>/…`. Unknown plugin
 * paths stay 404 — they must not fall through to the SPA index.
 */
export const withPluginFiles = (ui: UIApp, pluginsDir: string): ServedUI =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (!pathname.startsWith(PLUGIN_URL_PREFIX)) return yield* ui;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return HttpServerResponse.empty({ status: 405 });
    }
    const file = resolvePluginFile(pluginsDir, pathname);
    if (file === null) return notFound;
    return yield* HttpServerResponse.file(file).pipe(Effect.catch(() => Effect.succeed(notFound)));
  });
