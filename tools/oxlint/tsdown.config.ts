import { defineConfig } from "tsdown";

export default defineConfig({
  // Named entries become `dist/<name>.mjs` (Node + ESM + fixedExtension).
  // Oxlint loads those paths from the repo root `.oxlintrc.json`.
  entry: {
    "anti-slop": "./anti-slop/index.ts",
    "anti-slop-effect": "./anti-slop/effect/index.ts",
    "node-import-style": "./node-import-style.ts",
    "feature-boundaries": "./feature-boundaries.ts",
    "query-policy": "./query-policy.ts",
  },
  platform: "node",
  format: ["esm"],
  deps: {
    // Keep `@oxlint/plugins` and Node builtins as runtime imports so oxlint
    // and the bundled plugins share one copy of the plugin API.
    neverBundle: true,
  },
  dts: false,
  hash: false,
});
