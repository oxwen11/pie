import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**", "!src/globals.css", "!src/ai-elements/pie-loader.css"],
  format: ["esm"],
  target: "esnext",
  platform: "browser",
  unbundle: true,
  tsconfig: true,
  external: [/react/, /react\/.*/],
});
