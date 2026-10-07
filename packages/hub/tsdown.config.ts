import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  format: ["esm"],
  fixedExtension: false,
  minify: true,
  clean: true,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  dts: false,
  env: { NODE_ENV: "production" },
});
