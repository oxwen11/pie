import { defineConfig } from "tsdown";

export default defineConfig({
  // Named entries become `dist/anti-slop.mjs` and `dist/anti-slop-effect.mjs`
  // (Node + ESM + fixedExtension). Oxlint loads those paths from the repo
  // root `.oxlintrc.json`.
  entry: {
    "anti-slop": "./anti-slop/index.ts",
    "anti-slop-effect": "./anti-slop/effect/index.ts",
  },
  platform: "node",
  format: ["esm"],
  deps: {
    // Match the previous esbuild `--packages=external`: keep `@oxlint/plugins`
    // as a runtime import so oxlint and the plugin share one copy.
    neverBundle: true,
  },
  dts: false,
  hash: false,
});
