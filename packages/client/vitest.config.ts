import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "client",
    environment: "node",
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
  },
});
