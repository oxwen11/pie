import path from "node:path";
import url from "node:url";

import { Effect, FileSystem, type Path } from "effect";
import type { HttpPlatform } from "effect/unstable/http";
import { HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/unstable/http";

/**
 * Answers everything the API routes did not claim. `never` on the error channel
 * because a UI miss is a response (404 / 503), not a failure.
 */
export type UIApp = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
>;

const notFound = HttpServerResponse.text("Not Found", { status: 404 });

const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "no-cache";
const ERROR_CACHE_CONTROL = "no-store";

/**
 * Match Vite's default eight-character content hash. A successful file response
 * still has to pass this check: merely living under `/assets` is not enough to
 * earn a year-long immutable lifetime.
 */
const VERSIONED_ASSET_PATH = /^\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8}\.[^/]+$/;

/**
 * Mirror `HttpStaticServer`'s decode + normalize order before classifying the
 * response. In particular, `/assets/%2e%2e%2findex.html` resolves to the app
 * shell, not an asset. Node's host path implementation matches the NodePath
 * layer used by the static server; separators are converted back to URL form
 * only after traversal checks.
 */
const normalizedRequestPath = (requestUrl: string): string | undefined => {
  const queryIndex = requestUrl.indexOf("?");
  const urlPath = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decodedPath.includes("\u0000")) return undefined;

  const normalizedPath = path.normalize(
    decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath,
  );
  if (normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`)) {
    return undefined;
  }
  return `/${normalizedPath.split(path.sep).join("/")}`;
};

/** Apply the built-UI cache contract after the static handler resolves a response. */
export const withStaticCacheControl = (
  requestUrl: string,
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  if (response.status !== 200 && response.status !== 206 && response.status !== 304) {
    return HttpServerResponse.setHeader(response, "cache-control", ERROR_CACHE_CONTROL);
  }

  const pathname = normalizedRequestPath(requestUrl);
  return HttpServerResponse.setHeader(
    response,
    "cache-control",
    pathname !== undefined && VERSIONED_ASSET_PATH.test(pathname)
      ? IMMUTABLE_ASSET_CACHE_CONTROL
      : REVALIDATE_CACHE_CONTROL,
  );
};

/** `node:url` has no Effect equivalent; the URLs below are all module-relative. */
const fromModuleUrl = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

/**
 * Locate the built web UI: the packaged layout ships it next to the server
 * bundle as `client/`, while running from monorepo source falls back to
 * `apps/app/dist`.
 */
const resolveStaticDir = (
  override: string | undefined,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = override
      ? [override]
      : [
          "./client/", // packaged: dist/client next to dist/cli.js
          "../../../../apps/app/dist/", // monorepo, from src/node
          "../../../apps/app/dist/", // monorepo, from packages/pie/dist
        ];
    for (const candidate of candidates) {
      const dir = override ? path.resolve(candidate) : path.resolve(fromModuleUrl(candidate));
      const built = yield* fs
        .exists(path.join(dir, "index.html"))
        .pipe(Effect.orElseSucceed(() => false));
      if (built) return dir;
    }
    return undefined;
  });

/**
 * The UI-serving half of the server, isolated from auth/CORS/routing:
 * `HttpStaticServer` over the built bundle, and a 503 when the bundle has not
 * been built. There is no dev branch — `apps/app` runs its own `vite dev` and
 * proxies `/api` and `/ws/rpc` here, so this server serves files in every mode
 * and never hosts a bundler.
 */
export const createUIHandler = (
  options: { readonly staticDir?: string } = {},
): Effect.Effect<
  UIApp,
  never,
  // `Path` is not ours: `HttpStaticServer.make` asks for it. Our own path math
  // below is pure and stays on `node:path`.
  FileSystem.FileSystem | HttpPlatform.HttpPlatform | Path.Path
> =>
  Effect.gen(function* () {
    const staticDir = yield* resolveStaticDir(options.staticDir);
    if (!staticDir) {
      return Effect.succeed(
        withStaticCacheControl(
          "/",
          HttpServerResponse.text("Web UI not built. Run the @getpie/app build first.", {
            status: 503,
          }),
        ),
      );
    }

    // `spa: true` is the old `sirv(dir, { single: true })`: an unknown path
    // falls back to index.html so the client router owns deep links.
    // No `cacheControl` here: the option is global, and `HttpStaticServer`
    // reuses `serveFile` for the SPA fallback. The wrapper below gives hashed
    // assets a long immutable lifetime while index.html and deep-link
    // fallbacks always revalidate.
    const assets = yield* HttpStaticServer.make({ root: staticDir, spa: true }).pipe(
      // `resolveStaticDir` just proved `index.html` exists here, so a platform
      // failure opening the same directory is a defect, not a served error.
      Effect.catchTag("PlatformError", (cause) =>
        Effect.die(
          new Error(`invariant: static server could not open verified UI bundle at ${staticDir}`, {
            cause,
          }),
        ),
      ),
    );

    // A path that matches no file is a 404; anything else went wrong on our
    // side. `RouteNotFound` covers both a missing asset and a deep link the
    // SPA fallback declined (it only rewrites extensionless paths from a
    // client that accepts HTML — a browser navigation, never a fetch).
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* assets.pipe(
        Effect.catch((error) =>
          error.reason._tag === "RouteNotFound"
            ? Effect.succeed(notFound)
            : Effect.as(
                Effect.logError("static asset read failed", error),
                HttpServerResponse.text("Internal Server Error", { status: 500 }),
              ),
        ),
      );
      return withStaticCacheControl(request.url, response);
    });
  });
