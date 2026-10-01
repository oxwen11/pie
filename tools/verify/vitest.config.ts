import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verify",
    environment: "node",
    fsModuleCache: true,
    // These files spawn CLI/browser/process-tree fixtures. Concurrent files
    // starve startup deadlines under the full suite; per-test isolation cases
    // still exercise multiple live runs without relaxing their assertions.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
