import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/node/cli.ts"],
  platform: "node",
  // `@getpie/cli#build` waits for `@getpie/app#build`; ship that complete
  // artifact beside the final CLI so runtime lookup never depends on a repo.
  copy: {
    from: "../../apps/app/dist",
    to: "dist",
    rename: "client",
  },
  deps: {
    // The private server/harness/contract packages are compiled into the CLI.
    // Whitelist their bundled runtime dependencies so additions fail closed.
    // `simple-git` (and its tree) is pulled in by GitService on the serve path.
    onlyBundle: [
      "effect",
      "@effect/platform-node-shared",
      "@effect/platform-node",
      "@standardserver/shared",
      "@orpc/experimental-effect",
      "simple-git",
      /^@simple-git\//,
      /^@kwsites\//,
      "debug",
      "ms",
      "supports-color",
      "has-flag",
      /^mdast-util-/,
      /^micromark(?:-|$)/,
      /^unist-util-/,
      "decode-named-character-reference",
      "character-entities",
    ],
  },
  dts: false,
  clean: true,
  env: {
    NODE_ENV: "production",
    PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
  },
});
