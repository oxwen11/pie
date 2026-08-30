import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/build-id.ts", "src/compatibility.ts", "src/development-scope.ts"],
  platform: "node",
  format: ["esm"],
  dts: true,
  clean: true,
});
