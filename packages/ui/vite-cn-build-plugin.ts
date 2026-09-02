import childProcess from "node:child_process";

import type { Plugin } from "vite";

/** Regenerate compiled cn merge tables before Vite bundles @getpie/ui. */
export function cnBuildPlugin(): Plugin {
  return {
    name: "cn-build",
    buildStart() {
      childProcess.execSync("pnpm run cn-build", { cwd: import.meta.dirname, stdio: "inherit" });
    },
  };
}
