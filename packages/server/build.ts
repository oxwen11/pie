import module from "node:module";
import path from "node:path";
import url from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { Effect, FileSystem } from "effect";

type BuildOptions = {
  readonly entrypoints: string[];
  readonly outdir: string;
  readonly naming: string;
  readonly target: "bun";
  readonly format: "esm";
  readonly external?: string[];
  readonly define?: Record<string, string>;
};

type BuildResult = {
  readonly success: boolean;
  readonly logs: readonly unknown[];
};

declare const Bun: {
  build(options: BuildOptions): Promise<BuildResult>;
};

const piEntry = url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piDir = path.dirname(path.dirname(piEntry));
const distDir = url.fileURLToPath(new URL("./dist", import.meta.url));
const piOutDir = path.join(distDir, "pi-process");
const photonEntry = module.createRequire(piEntry).resolve("@silvia-odwyer/photon-node");

const build = (options: BuildOptions) =>
  Effect.promise(() => Bun.build(options)).pipe(
    Effect.flatMap((result) =>
      result.success
        ? Effect.succeed(result)
        : Effect.die(new Error(result.logs.map(String).join("\n") || "Bun build failed")),
    ),
  );

NodeRuntime.runMain(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(distDir, { recursive: true, force: true });
    yield* fs.makeDirectory(piOutDir, { recursive: true });

    yield* build({
      entrypoints: [url.fileURLToPath(new URL("./src/http/main.ts", import.meta.url))],
      outdir: distDir,
      naming: "server.mjs",
      target: "bun",
      format: "esm",
      external: ["node-pty", "vite"],
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "process.env.PIE_DAEMON_COMPATIBILITY_KEY": JSON.stringify(resolveDaemonCompatibilityKey()),
      },
    });

    for (const [name, entry] of Object.entries({
      "pi-process": url.fileURLToPath(new URL("./src/harness/pi/rpc/entry.ts", import.meta.url)),
      "image-resize-worker": path.join(piDir, "dist/utils/image-resize-worker.js"),
    })) {
      yield* build({
        entrypoints: [entry],
        outdir: piOutDir,
        naming: `${name}.js`,
        target: "bun",
        format: "esm",
        define: { PI_BUNDLED_NODE: "true" },
      });
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
      yield* fs.copy(path.join(piDir, asset), path.join(piOutDir, asset));
    }
    const readme = path.join(piDir, "README.md");
    yield* fs.copy(
      (yield* fs.exists(readme)) ? readme : path.join(piDir, "docs/index.md"),
      path.join(piOutDir, "README.md"),
    );
    yield* fs.copy(
      path.join(path.dirname(photonEntry), "photon_rs_bg.wasm"),
      path.join(piOutDir, "photon_rs_bg.wasm"),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
