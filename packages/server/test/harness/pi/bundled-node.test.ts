import assert from "node:assert/strict";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const piProcessBundle = url.fileURLToPath(
  new URL("../../../dist/pi-process/pi-process.js", import.meta.url),
);

layer(NodeServices.layer, { excludeTestServices: true })("bundled Pi host modules", (it) => {
  it.effect("loads user extensions from VIRTUAL_MODULES in pie-pi-process", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const piProcess = yield* fs.readFileString(piProcessBundle);

      assert.match(piProcess, /isBundledNode = true/);
      assert.doesNotMatch(piProcess, /typeof PI_BUNDLED_NODE/);
    }),
  );
});
