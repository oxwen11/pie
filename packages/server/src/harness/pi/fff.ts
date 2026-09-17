import fs from "node:fs";
import path from "node:path";

/**
 * Sibling `fff/node_modules` next to pie-pi-process. Do not import
 * `@ff-labs/pi-fff` from this module — bun-build must not inline the FFI graph.
 */

export const FFF_OVERRIDE_FLAGS = new Map<string, boolean | string>([
  ["fff-mode", "override"],
  ["fff-follow-symlinks", false],
]);

export function fffIsland(processEntry: string): string {
  return path.join(path.dirname(processEntry), "..", "fff", "node_modules");
}

export function fffExtensionPath(processEntry: string): string | undefined {
  const entry = path.join(fffIsland(processEntry), "@ff-labs", "pi-fff", "src", "index.ts");
  return fs.existsSync(entry) ? entry : undefined;
}

export function fffNodePathEnv(
  env: NodeJS.ProcessEnv,
  processEntry: string,
): NodeJS.ProcessEnv | undefined {
  const island = fffIsland(processEntry);
  if (!fs.existsSync(island)) return undefined;
  const current = env.NODE_PATH;
  return {
    NODE_PATH:
      current === undefined || current.trim() === ""
        ? island
        : `${island}${path.delimiter}${current}`,
  };
}

export function applyFffNodePath(env: NodeJS.ProcessEnv, processEntry: string): void {
  const overlay = fffNodePathEnv(env, processEntry);
  if (overlay?.NODE_PATH !== undefined) env.NODE_PATH = overlay.NODE_PATH;
}
