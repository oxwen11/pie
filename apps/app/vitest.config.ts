import { defineConfig } from "vitest/config";

import { appAlias, appDir, browserTsTests } from "./vitest-shared";

export default defineConfig({
  ...appAlias,
  test: {
    name: "app",
    dir: appDir,
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
    exclude: browserTsTests,
  },
});
