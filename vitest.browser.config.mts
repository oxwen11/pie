import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    projects: ["packages/ui/vitest.config.ts", "apps/app/vitest.browser.config.ts"],
  },
});
