import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "cli",
    environment: "node",
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
  },
});
