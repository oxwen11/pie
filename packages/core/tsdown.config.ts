import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/compatibility.ts", "src/development-scope.ts", "src/executable.ts"],
  platform: "node",
  format: ["esm"],
  dts: true,
  clean: true,
});
