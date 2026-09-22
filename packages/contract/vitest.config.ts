import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "contract",
    environment: "node",
    fsModuleCache: true,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
});
