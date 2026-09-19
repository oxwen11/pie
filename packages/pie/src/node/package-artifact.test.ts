import assert from "node:assert/strict";
import url from "node:url";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const fromModuleUrl = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

layer(NodeFileSystem.layer)("published CLI bundle", (it) => {
  it.effect("ships the complete Pi runtime at the exported entry path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sourceDir = fromModuleUrl("../../../server/dist/pi-process");
      const runtimeDir = fromModuleUrl("../../dist/pi-process");
      const [sourceEntries, runtimeEntries] = yield* Effect.all([
        fs.readDirectory(sourceDir, { recursive: true }),
        fs.readDirectory(runtimeDir, { recursive: true }),
      ]);

      assert.deepEqual(Array.from(runtimeEntries).sort(), Array.from(sourceEntries).sort());
      yield* fs.access(url.fileURLToPath(import.meta.resolve("@getpie/cli/pi-process")));
    }),
  );

  it.effect("ships the fff JS island and the current-platform native lib", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.access(fromModuleUrl("../../dist/fff/node_modules/@ff-labs/pi-fff/src/index.ts"));
      const labs = yield* fs.readDirectory(fromModuleUrl("../../dist/fff/node_modules/@ff-labs"), {
        recursive: true,
      });
      const nativePackages = new Set(
        Array.from(labs)
          .map((entry) => entry.split(/[\\/]/)[0])
          .filter((name) => name !== undefined && name.startsWith("fff-bin-")),
      );
      assert.equal(
        nativePackages.size,
        1,
        `expected one fff-bin-* package, got ${[...nativePackages].join(", ")}`,
      );
      const processJs = yield* fs.readFileString(
        fromModuleUrl("../../dist/pi-process/pi-process.js"),
      );
      assert.ok(!processJs.includes("@ff-labs/fff-bun"));
      assert.ok(!processJs.includes("bun:ffi"));
      assert.ok(!processJs.includes("fffFileAnnotation"));
      assert.ok(!processJs.includes("function loadSdk"));
    }),
  );

  it.effect("ships the complete web UI beside the CLI entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sourceDir = fromModuleUrl("../../../../apps/app/dist");
      const clientDir = fromModuleUrl("../../dist/client");
      const indexPath = fromModuleUrl("../../dist/client/index.html");
      const [sourceEntries, clientEntries, indexHtml] = yield* Effect.all(
        [
          fs.readDirectory(sourceDir, { recursive: true }),
          fs.readDirectory(clientDir, { recursive: true }),
          fs.readFileString(indexPath),
        ],
        { concurrency: "unbounded" },
      );
      const entryAssets = Array.from(
        indexHtml.matchAll(/(?:href|src)="\/(assets\/[^"]+)"/g),
        (match) => match[1],
      );

      assert.deepEqual(Array.from(clientEntries).sort(), Array.from(sourceEntries).sort());
      assert.ok(entryAssets.length > 0);
      yield* Effect.forEach(
        entryAssets,
        (asset) => fs.access(fromModuleUrl(`../../dist/client/${asset}`)),
        { concurrency: "unbounded", discard: true },
      );
    }),
  );
});
