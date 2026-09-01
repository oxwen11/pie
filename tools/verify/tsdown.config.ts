import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "./src/cli.ts",
    runtime: "./src/runtime/index.ts",
  },
  platform: "node",
  format: ["esm"],
  dts: false,
  clean: true,
});
