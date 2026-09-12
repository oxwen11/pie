import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

const shared = {
  platform: "node" as const,
  format: ["esm" as const],
  minify: true,
  deps: {
    // The private server/harness/contract packages are compiled into the CLI.
    // Whitelist their bundled runtime dependencies so additions fail closed.
    // `simple-git` (and its tree) is pulled in by GitService on the serve path.
    onlyBundle: [
      "effect",
      "@effect/platform-node-shared",
      "@effect/platform-node",
      "@standard-server/shared",
      "@orpc/experimental-effect",
      "simple-git",
      /^@simple-git\//,
      /^@kwsites\//,
      "debug",
      "ms",
      "supports-color",
      "has-flag",
    ],
  },
  dts: false,
  shims: true,
  env: {
    NODE_ENV: "production",
    PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
  },
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/node/cli.ts"],
    clean: true,
    // `@getpie/cli#build` waits for `@getpie/app#build`; ship every runtime
    // artifact beside the final CLI so lookup never depends on a repo.
    copy: [
      {
        from: "../../apps/app/dist",
        to: "dist",
        rename: "client",
      },
      {
        from: "../server/dist/pi-process",
        to: "dist",
        rename: "pi-process",
      },
      {
        from: "../server/dist/fff",
        to: "dist",
        rename: "fff",
      },
      {
        from: "../server/dist/resources",
        to: "dist",
        rename: "resources",
      },
    ],
  },
  {
    ...shared,
    // Own build so the hop is one file, not a chunk shared with `pie`.
    entry: ["src/node/relay.ts"],
    clean: false,
  },
]);
