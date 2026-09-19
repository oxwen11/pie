import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/unstable/http";

import { withPluginFiles } from "../../src/http/plugins";
import type { UIApp } from "../../src/http/ui";

const StaticPlatformLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeHttpPlatform.layer,
);

const fallback: UIApp = Effect.succeed(HttpServerResponse.text("ui-fallback"));

layer(StaticPlatformLayer)("withPluginFiles", (effectIt) => {
  effectIt.effect("serves a panel file and keeps unknown plugin paths off the SPA", () =>
    Effect.gen(function* () {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-plugins-http-"));
      const pluginsDir = path.join(home, "plugins");
      fs.mkdirSync(path.join(pluginsDir, "demo"), { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, "demo", "index.html"), "<h1>Demo</h1>");

      const { handler } = HttpEffect.toWebHandlerLayer(
        withPluginFiles(fallback, pluginsDir),
        StaticPlatformLayer,
      );

      const file = yield* Effect.promise(() =>
        handler(new Request("http://127.0.0.1/plugins/demo/index.html")),
      );
      assert.equal(file.status, 200);
      assert.match(yield* Effect.promise(() => file.text()), /Demo/);

      const missing = yield* Effect.promise(() =>
        handler(new Request("http://127.0.0.1/plugins/demo/missing.html")),
      );
      assert.equal(missing.status, 404);

      const escaped = yield* Effect.promise(() =>
        handler(new Request("http://127.0.0.1/plugins/demo/%2e%2e/secret")),
      );
      assert.equal(escaped.status, 404);

      const other = yield* Effect.promise(() => handler(new Request("http://127.0.0.1/draft")));
      assert.equal(yield* Effect.promise(() => other.text()), "ui-fallback");
    }),
  );
});
