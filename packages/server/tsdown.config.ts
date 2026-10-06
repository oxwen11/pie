import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

export default defineConfig({
  platform: "node",
  format: ["esm"],
  dts: false,
  clean: false,
  shims: true,
  // Package is `"type": "module"`, so the forkable entry is `dist/server.js`.
  fixedExtension: false,
  // Object entry key → output name. Dynamic imports stay in that file so the
  // desktop supervisor can spawn one artifact, not a chunk graph.
  entry: { server: "src/http/main.ts" },
  outputOptions: {
    codeSplitting: false,
  },
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
});
