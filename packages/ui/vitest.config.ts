import { defineConfig } from "vitest/config";

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
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // First Streamdown/Shiki highlighter init exceeds vitest's 5s default on CI.
    hookTimeout: 20_000,
    testTimeout: 15_000,
  },
});
