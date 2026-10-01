import assert from "node:assert/strict";
import path from "node:path";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const serverBundle = url.fileURLToPath(new URL("../../../dist/server.js", import.meta.url));
const piProcessBundle = url.fileURLToPath(
  new URL("../../../dist/pi-process/pi-process.js", import.meta.url),
);

layer(NodeServices.layer, { excludeTestServices: true })("bundled Pi host modules", (it) => {
  it.effect("loads user extensions from VIRTUAL_MODULES in the daemon and pie-pi-process", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // tsdown may emit the folded branch in a sibling chunk, not the entry.
      const distDir = path.dirname(serverBundle);
      const chunkNames = (yield* fs.readDirectory(distDir)).filter((name) => name.endsWith(".js"));
      const server = (yield* Effect.forEach(
        chunkNames,
        (name) => fs.readFileString(path.join(distDir, name)),
        { concurrency: "unbounded" },
      )).join("\n");
      const piProcess = yield* fs.readFileString(piProcessBundle);

      // tsdown folds PI_BUNDLED_NODE so the embedded-module branch is always selected.
      assert.match(server, /usesEmbeddedModules = [^;]+ \|\| true/);
      assert.match(server, /virtualModules: await getVirtualModules\(\)/);
      assert.match(server, /tryNative: false/);
      assert.doesNotMatch(server, /typeof PI_BUNDLED_NODE/);

      assert.match(piProcess, /isBundledNode = true/);
      assert.doesNotMatch(piProcess, /typeof PI_BUNDLED_NODE/);
    }),
  );
});
