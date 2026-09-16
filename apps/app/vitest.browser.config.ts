import url from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { pieBrowser, pieBrowserOptimizeDeps } from "../../tools/testing/vitest-browser";
import { appAlias, appDir, browserTsTests } from "./vitest.shared";

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
  ...appVite,
  test: {
    name: "app-browser",
    dir: appDir,
    fsModuleCache: true,
    include: ["src/**/*.test.tsx", ...browserTsTests],
    browser: pieBrowser(),
  },
});
