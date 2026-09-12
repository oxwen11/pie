import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { createBashTool } from "./pi-sdk";

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

export function piBashExtension(cwd: string): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      createBashTool(cwd, {
        spawnHook: (context) => ({ ...context, env: filterPiBashEnv(context.env) }),
      }),
    );
  };
}
