import { defineConfig } from "vitest/config";

/**
 * Files that spawn `git` / `git worktree add` against temp repos. They stall
 * and contend when Vitest runs them in parallel with each other — keep them
 * in a sequential project so the rest of the server suite can use file
 * parallelism.
 */
export const gitContentionTestFiles = [
  "test/git.test.ts",
  "test/rpc-git.test.ts",
  "test/rpc-pull-request.test.ts",
  "test/rpc-session.test.ts",
  "test/worktree-service.test.ts",
] as const;

const shared = {
  environment: "node" as const,
  fsModuleCache: true,
  // Git fixtures (worktree add, multi-commit reviews) stall under load.
  testTimeout: 30_000,
};

export const serverParallelProject = {
  test: {
    name: "server",
    ...shared,
    include: ["test/**/*.test.ts"],
    exclude: [...gitContentionTestFiles],
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
};

export const serverGitProject = {
  test: {
    name: "server-git",
    ...shared,
    include: [...gitContentionTestFiles],
    fileParallelism: false,
  },
};

export default defineConfig({
  test: {
    projects: [serverParallelProject, serverGitProject],
  },
});
