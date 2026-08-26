import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    // Git worktree tests contend on temp dirs when files run in parallel.
    fileParallelism: false,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
});
