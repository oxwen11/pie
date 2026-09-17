import url from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { pieBrowser, pieBrowserOptimizeDeps } from "../../tools/testing/vitest-browser";
import { appAlias, appDir, browserTsTests } from "./vitest.shared";

const browserSetupFiles = [
  url.fileURLToPath(new URL("../../tools/testing/browser-locators.ts", import.meta.url)),
];

const appVite = {
  ...appAlias,
  optimizeDeps: pieBrowserOptimizeDeps,
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: url.fileURLToPath(new URL("./src/routes", import.meta.url)),
      generatedRouteTree: url.fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
    }),
    react(),
    tailwindcss(),
  ],
};

export default defineConfig({
  ...appAlias,
  test: {
    fsModuleCache: true,
    projects: [
      {
        ...appVite,
        test: {
          name: "app-browser",
          dir: appDir,
          include: ["src/**/*.test.tsx", ...browserTsTests],
          setupFiles: browserSetupFiles,
          browser: pieBrowser(),
        },
      },
      {
        ...appVite,
        test: {
          name: "app-e2e",
          dir: appDir,
          include: ["e2e/**/*.e2e.test.tsx"],
          setupFiles: browserSetupFiles,
          globalSetup: ["./e2e/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { concurrent: false },
          browser: pieBrowser({ viewport: { width: 1280, height: 800 } }),
        },
      },
    ],
  },
});
