import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "orpc-cli",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
