import path from "node:path";

/**
 * Path to the copied `@ff-labs/pi-fff` install: a sibling `fff/node_modules`
 * next to pie-pi-process. Do not import `@ff-labs/pi-fff` from this module —
 * bun-build must not inline the FFI graph.
 */

export const FFF_OVERRIDE_FLAGS = new Map<string, boolean | string>([
  ["fff-mode", "override"],
  ["fff-follow-symlinks", false],
]);

export function fffIsland(processEntry: string): string {
  return path.join(path.dirname(processEntry), "..", "fff", "node_modules");
}

export function fffExtensionEntry(processEntry: string): string {
  return path.join(fffIsland(processEntry), "@ff-labs", "pi-fff", "src", "index.ts");
}

export function fffNodePathEnv(env: NodeJS.ProcessEnv, processEntry: string) {
  const island = fffIsland(processEntry);
  const current = env.NODE_PATH;
  return {
    NODE_PATH:
      current === undefined || current.trim() === ""
        ? island
        : `${island}${path.delimiter}${current}`,
  };
}

export function applyFffNodePath(env: NodeJS.ProcessEnv, processEntry: string): void {
  env.NODE_PATH = fffNodePathEnv(env, processEntry).NODE_PATH;
}
