import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
});
