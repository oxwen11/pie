import { pieBrowser, pieBrowserOptimizeDeps } from "@getpie/test/vitest-browser";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  optimizeDeps: {
    include: [...pieBrowserOptimizeDeps.include, "streamdown", "@streamdown/code", "shiki"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: "ui",
    fsModuleCache: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // First Streamdown/Shiki highlighter init exceeds vitest's 5s default on CI.
    hookTimeout: 20_000,
    testTimeout: 15_000,
    browser: pieBrowser(),
  },
});
