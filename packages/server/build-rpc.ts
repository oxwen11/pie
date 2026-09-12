import module from "node:module";
import path from "node:path";
import url from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const piEntry = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piDir = path.dirname(path.dirname(piEntry));
const outDir = url.fileURLToPath(new URL("./dist/pi-rpc", import.meta.url));
const photonEntry = module.createRequire(piEntry).resolve("@silvia-odwyer/photon-node");

NodeRuntime.runMain(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    yield* fs.remove(outDir, { recursive: true, force: true });
    yield* fs.makeDirectory(outDir, { recursive: true });

    for (const [name, entry] of Object.entries({
      "pi-rpc": url.fileURLToPath(new URL("./src/harness/pi/rpc/entry.ts", import.meta.url)),
      "image-resize-worker": path.join(piDir, "dist/utils/image-resize-worker.js"),
    })) {
      const exitCode = yield* spawner.exitCode(
        ChildProcess.make(
          process.execPath,
          [
            "build",
            entry,
            "--target",
            "bun",
            // Use Pi's bundled extension modules, never source-tree aliases.
            "--define",
            "PI_BUNDLED_NODE=true",
            "--outfile",
            path.join(outDir, `${name}.js`),
          ],
          { stdout: "inherit", stderr: "inherit" },
        ),
      );
      if (exitCode !== 0) yield* Effect.die(new Error(`Building ${name} failed: ${exitCode}`));
    }

    // Keep Pi's package layout so getPackageDir(), documentation and HTML export
    // resolve beside the bundle, including when copied outside node_modules.
    for (const asset of [
      "package.json",
      "CHANGELOG.md",
      "docs",
      "examples",
      "dist/core/export-html",
    ]) {
      yield* fs.copy(path.join(piDir, asset), path.join(outDir, asset));
    }
    const readme = path.join(piDir, "README.md");
    yield* fs.copy(
      (yield* fs.exists(readme)) ? readme : path.join(piDir, "docs/index.md"),
      path.join(outDir, "README.md"),
    );
    yield* fs.copy(
      path.join(path.dirname(photonEntry), "photon_rs_bg.wasm"),
      path.join(outDir, "photon_rs_bg.wasm"),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
