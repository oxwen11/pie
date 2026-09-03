import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fsModuleCache: true,
    // Git fixtures (worktree add, multi-commit reviews) exceed 15s when
    // turbo runs every package's Vitest at once.
    testTimeout: 30_000,
    // Git worktree tests contend on temp dirs when files run in parallel.
    fileParallelism: false,
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
});
