import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    projects: [
      "packages/!(ui)/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "tools/*/vitest.config.ts",
    ],
  },
});
