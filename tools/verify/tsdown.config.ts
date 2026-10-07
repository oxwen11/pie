import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "./src/cli.ts",
    runtime: "./src/runtime/index.ts",
  },
  platform: "node",
  format: ["esm"],
  // Package is `"type": "module"`; emit `.js` instead of `.mjs`.
  fixedExtension: false,
  dts: false,
  clean: true,
});
