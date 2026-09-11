import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

const shared = {
  platform: "node" as const,
  format: ["esm" as const],
  dts: false,
  clean: false,
  shims: true,
};

export default defineConfig([
  {
    ...shared,
    // The forkable server bundle. Emitted as `dist/server.mjs` (object entry key
    // → output name) so the desktop supervisor and the daemon launcher can spawn
    // a single self-contained file.
    entry: { server: "src/http/main.ts" },
    deps: {
      // Inline everything so the forked artifact needs no node_modules resolution.
      // `vite` stays external: nothing in this package imports it. The UI is a
      // prebuilt static bundle (`http/ui.ts`); `apps/app` runs its own `vite dev`.
      alwaysBundle: [/.*/],
      neverBundle: ["vite", "node-pty"],
      onlyBundle: false,
    },
    env: {
      NODE_ENV: "production",
      PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
    },
  },
  {
    ...shared,
    // Separate process: Pi's AgentSession from node_modules, pie-owned JSONL loop.
    entry: { "pi-rpc": "src/harness/pi/rpc/entry.ts" },
    deps: {
      neverBundle: ["@earendil-works/pi-coding-agent"],
    },
  },
]);
