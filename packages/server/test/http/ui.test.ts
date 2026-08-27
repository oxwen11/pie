import assert from "node:assert/strict";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { createUIHandler, withStaticCacheControl } from "../../src/http/ui";

const StaticPlatformLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeHttpPlatform.layer,
);

const makeStaticHandler = (staticDir: string) =>
  Effect.gen(function* () {
    const app = yield* createUIHandler({ staticDir });
    return HttpEffect.toWebHandler(app);
  });

describe("withStaticCacheControl", () => {
  it("caches versioned Vite assets immutably", () => {
    const response = withStaticCacheControl(
      "/assets/index-pjSmfRhB.js",
      HttpServerResponse.text("asset"),
    );

    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("keeps index.html and SPA fallbacks revalidating", () => {
    const index = withStaticCacheControl("/", HttpServerResponse.text("index"));
    const deepLink = withStaticCacheControl(
      "/projects/123/sessions/456",
      HttpServerResponse.text("index"),
    );

    expect(index.headers["cache-control"]).toBe("no-cache");
    expect(deepLink.headers["cache-control"]).toBe("no-cache");
  });

  it("does not make an unfingerprinted asset immutable", () => {
    const response = withStaticCacheControl("/assets/runtime.js", HttpServerResponse.text("asset"));

    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("does not make an extensionless SPA fallback under /assets immutable", () => {
    const response = withStaticCacheControl(
      "/assets/settings",
      HttpServerResponse.empty({ status: 304 }),
    );

    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("preserves immutable caching on range and conditional responses", () => {
    const range = withStaticCacheControl(
      "/assets/index-pjSmfRhB.js",
      HttpServerResponse.text("asset", { status: 206 }),
    );
    const notModified = withStaticCacheControl(
      "/assets/index-pjSmfRhB.js",
      HttpServerResponse.empty({ status: 304 }),
    );

    expect(range.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(notModified.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("does not cache missing assets or server failures", () => {
    const missing = withStaticCacheControl(
      "/assets/missing-deadbeef.js",
      HttpServerResponse.text("missing", { status: 404 }),
    );
    const failure = withStaticCacheControl(
      "/assets/index-pjSmfRhB.js",
      HttpServerResponse.text("failure", { status: 500 }),
    );

    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(failure.headers["cache-control"]).toBe("no-store");
  });
});

layer(StaticPlatformLayer)("createUIHandler cache policy", (effectIt) => {
  effectIt.effect("does not classify an encoded traversal to index.html as immutable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-static-" });
      yield* fs.writeFileString(
        path.join(staticDir, "index.html"),
        "<!doctype html><title>Pie</title>",
      );

      const handler = yield* makeStaticHandler(staticDir);

      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/assets/%2e%2e%2findex.html")),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("cache-control"), "no-cache");

      const etag = response.headers.get("etag");
      assert.ok(etag);
      const notModified = yield* Effect.promise(() =>
        handler(
          new Request("http://localhost/assets/%2e%2e%2findex.html", {
            headers: { "if-none-match": etag },
          }),
        ),
      );
      assert.equal(notModified.status, 304);
      assert.equal(notModified.headers.get("cache-control"), "no-cache");
    }),
  );

  effectIt.effect("marks a real static-handler 404 as no-store", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-static-" });
      yield* fs.writeFileString(
        path.join(staticDir, "index.html"),
        "<!doctype html><title>Pie</title>",
      );

      const handler = yield* makeStaticHandler(staticDir);
      const response = yield* Effect.promise(() =>
        handler(new Request("http://localhost/assets/missing-deadbeef.js")),
      );

      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }),
  );

  effectIt.effect("marks a missing UI bundle 503 as no-store", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const emptyDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-static-empty-" });
      const handler = yield* makeStaticHandler(emptyDir);
      const response = yield* Effect.promise(() => handler(new Request("http://localhost/")));

      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }),
  );
});
