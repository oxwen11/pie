import { defineConfig } from "tsdown";

export default defineConfig({
  // Entry names are the oxlint plugin names and the package.json export
  // subpaths (`@getpie/oxlint/pie`, …). Dist files stay gitignored; the
  // repo-root `.oxlintrc.json` loads them through those exports.
  entry: {
    pie: "./pie.ts",
    "pie-boundaries": "./feature-boundaries.ts",
    "pie-query": "./query-policy.ts",
    "anti-slop": "./anti-slop/index.ts",
    "anti-slop-effect": "./anti-slop/effect/index.ts",
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
