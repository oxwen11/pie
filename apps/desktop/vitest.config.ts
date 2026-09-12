import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "desktop",
    environment: "node",
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
  },
});
