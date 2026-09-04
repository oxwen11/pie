import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "effect-json-store",
    environment: "node",
    fsModuleCache: true,
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
