import {
  createBashTool,
  createPowerShellTool,
  type BashSpawnContext,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

const BLOCKED_EXACT = new Set(["PORT", "ELECTRON_RENDERER_PORT", "ELECTRON_RUN_AS_NODE"]);

function isBlockedPiUserCommandEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  if (normalized.startsWith("PIE_") || normalized.startsWith("VITE_")) return true;
  return BLOCKED_EXACT.has(normalized);
}

// Inherit-all minus product/host identity. An allowlist of PATH/HOME/LANG
// silently drops PSModulePath, DISPLAY, proxies, and toolchain vars.
export function filterPiUserCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || isBlockedPiUserCommandEnvKey(key)) continue;
    next[key] = value;
  }
  return next;
}

function piUserCommandSpawnHook(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: filterPiUserCommandEnv(context.env) };
}

export function createPiShellEnvExtension(cwd: string): InlineExtension {
  return {
    name: "@getpie/shell-env",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(createBashTool(cwd, { spawnHook: piUserCommandSpawnHook }));
      pi.registerTool(createPowerShellTool(cwd, { spawnHook: piUserCommandSpawnHook }));
    },
  };
}
