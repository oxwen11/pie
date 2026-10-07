import module from "node:module";
import path from "node:path";
import url from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { copyFffIsland } from "./scripts/copy-fff";

const piEntry = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piDir = path.dirname(path.dirname(piEntry));
const outDir = url.fileURLToPath(new URL("./dist/pi-process", import.meta.url));
const photonEntry = module.createRequire(piEntry).resolve("@silvia-odwyer/photon-node");

NodeRuntime.runMain(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    yield* fs.remove(outDir, { recursive: true, force: true });
    yield* fs.makeDirectory(outDir, { recursive: true });

    const piProcess = url.fileURLToPath(new URL("./src/harness/pi/rpc/entry.ts", import.meta.url));
    // Codemode embeds quickjs.wasm as a sibling asset. --outfile cannot emit it.
    const piProcessExit = yield* spawner.exitCode(
      ChildProcess.make(
        process.execPath,
        [
          "build",
          piProcess,
          "--target",
          "bun",
          // Use Pi's bundled extension modules, never source-tree aliases.
          "--define",
          "PI_BUNDLED_NODE=true",
          "--outdir",
          outDir,
          "--entry-naming",
          "pi-process.[ext]",
        ],
        { stdout: "inherit", stderr: "inherit" },
      ),
    );
    if (piProcessExit !== 0) {
      yield* Effect.die(new Error(`Building pi-process failed: ${piProcessExit}`));
    }

    // Pi resolves bundled workers beside the bundle (PI_BUNDLED_NODE).
    for (const [entry, outfile] of [
      ["dist/utils/image-resize-worker.js", "image-resize-worker.js"],
      ["dist/extensions/codemode/worker.js", "codemode-worker.js"],
    ] as const) {
      const workerExit = yield* spawner.exitCode(
        ChildProcess.make(
          process.execPath,
          [
            "build",
            path.join(piDir, entry),
            "--target",
            "bun",
            "--define",
            "PI_BUNDLED_NODE=true",
            "--outfile",
            path.join(outDir, outfile),
          ],
          { stdout: "inherit", stderr: "inherit" },
        ),
      );
      if (workerExit !== 0) {
        yield* Effect.die(new Error(`Building ${outfile} failed: ${workerExit}`));
      }
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

    // Sibling island — not inside pi-process/, so bun-build cannot inline
    // the fff FFI graph and the CLI artifact test can still diff that tree.
    yield* Effect.sync(() => {
      copyFffIsland(path.join(path.dirname(outDir), "fff"));
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
