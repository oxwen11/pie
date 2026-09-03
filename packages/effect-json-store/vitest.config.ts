import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fsModuleCache: true,
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
