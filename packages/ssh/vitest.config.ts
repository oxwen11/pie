import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ssh",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
