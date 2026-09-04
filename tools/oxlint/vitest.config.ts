import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "oxlint",
    environment: "node",
    fsModuleCache: true,
    include: ["*.test.ts"],
  },
});
