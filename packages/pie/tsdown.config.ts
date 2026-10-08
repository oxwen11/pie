import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

const shared = {
  platform: "node" as const,
  format: ["esm" as const],
  // Package is `"type": "module"`; emit `.js` instead of `.mjs`.
  fixedExtension: false,
  minify: true,
  deps: {
    // Bundle JavaScript dependencies so npm installs only the native addon.
    alwaysBundle: [/.*/],
    neverBundle: ["node-pty", "vite"],
    onlyBundle: false,
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
    // `server.js` is what the daemon runs; one build lets it share chunks with
    // `cli.js` instead of shipping a second copy of the server.
    entry: { cli: "src/node/cli.ts", server: "../server/src/http/main.ts" },
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
