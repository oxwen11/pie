import { defineConfig } from "vitest/config";

import { pieBrowser } from "../../tools/testing/vitest-browser";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
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
