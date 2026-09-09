import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-loop",
    environment: "node",
    fsModuleCache: true,
    include: ["tests/**/*.test.ts"],
  },
});
