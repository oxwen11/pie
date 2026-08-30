import assert from "node:assert/strict";
import url from "node:url";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const fromModuleUrl = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

layer(NodeFileSystem.layer)("published CLI bundle", (it) => {
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
