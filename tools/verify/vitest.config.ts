import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verify",
    environment: "node",
    fsModuleCache: true,
    include: ["src/**/*.test.ts"],
  },
});
