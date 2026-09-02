import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

export default defineConfig({
  // The forkable server bundle. Emitted as `dist/server.mjs` (object entry key
  // → output name) so the desktop supervisor and the daemon launcher can spawn
  // a single self-contained file.
  entry: { server: "src/http/main.ts" },
  platform: "node",
  format: ["esm"],
  deps: {
    // Inline everything so the forked artifact needs no node_modules resolution.
    // `vite` stays external: nothing in this package imports it. The UI is a
    // prebuilt static bundle (`http/ui.ts`); `apps/app` runs its own `vite dev`.
    alwaysBundle: [/.*/],
    neverBundle: ["vite"],
    onlyBundle: false,
  },
  dts: false,
  clean: false,
  shims: true,
  env: {
    NODE_ENV: "production",
    PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
  },
});
