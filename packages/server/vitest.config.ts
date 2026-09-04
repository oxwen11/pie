import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    fsModuleCache: true,
    // Git fixtures (worktree add, multi-commit reviews) stall under load.
    testTimeout: 30_000,
    // Git worktree tests contend on temp dirs when files run in parallel.
    fileParallelism: false,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
});
