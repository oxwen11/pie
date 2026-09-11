import {
  createBashTool,
  type BashSpawnContext,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

const BLOCKED_EXACT = new Set(["PORT", "ELECTRON_RENDERER_PORT", "ELECTRON_RUN_AS_NODE"]);

// Inherit-all minus product/host identity. An allowlist of PATH/HOME/LANG
// silently drops PSModulePath, DISPLAY, proxies, and toolchain vars.
export function filterPiBashEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (
      normalized.startsWith("PIE_") ||
      normalized.startsWith("VITE_") ||
      BLOCKED_EXACT.has(normalized)
    ) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function createPiBashExtension(cwd: string): InlineExtension {
  const spawnHook = (context: BashSpawnContext): BashSpawnContext => ({
    ...context,
    env: filterPiBashEnv(context.env),
  });
  return {
    name: "@getpie/bash",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(createBashTool(cwd, { spawnHook }));
    },
  };
}
