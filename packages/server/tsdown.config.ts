import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

export default defineConfig({
  platform: "node",
  format: ["esm"],
  dts: false,
  clean: false,
  shims: true,
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
  // Pi's extension loader uses VIRTUAL_MODULES only when this is true.
  // listAvailablePiModels runs in the daemon (server.mjs), not pie-pi-process;
  // without it, user packages such as pi-cursor fail to import @earendil-works/pi-ai
  // and never appear in the model picker.
  define: {
    PI_BUNDLED_NODE: "true",
  },
});
