import url from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { pieBrowser, pieBrowserOptimizeDeps } from "../../tools/testing/vitest-browser";

const src = url.fileURLToPath(new URL("./src", import.meta.url));
const appDir = import.meta.dirname;

const browserTsTests = [
  "src/theme.test.ts",
  "src/features/chat/components/transcript/tool-batch.test.ts",
  "src/features/projects/use-project-sessions.test.ts",
  "src/features/chat/components/input/use-chat-input-has-content.test.ts",
  "src/features/chat/components/input/chat-input-controller.test.ts",
];

const appAlias = {
  root: appDir,
  resolve: {
    alias: { "@": src, clsx: "cn", "tailwind-merge": "cn" },
    tsconfigPaths: true,
  },
};

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
        ...appAlias,
        test: {
          name: "app",
          dir: appDir,
          include: ["src/**/*.test.ts"],
          exclude: browserTsTests,
        },
      },
      {
        ...appVite,
        test: {
          name: "app-browser",
          dir: appDir,
          include: ["src/**/*.test.tsx", ...browserTsTests],
          browser: pieBrowser(),
        },
      },
      {
        ...appVite,
        test: {
          name: "app-e2e",
          dir: appDir,
          include: ["e2e/**/*.e2e.test.tsx"],
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
