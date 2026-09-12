import path from "node:path";
import url from "node:url";

import { Context, Layer } from "effect";

export class DesktopConfig extends Context.Service<
  DesktopConfig,
  {
    readonly isPackaged: boolean;
    readonly devUrl: string | undefined;
    readonly serverEntry: string;
    readonly resourcesPath: string;
  }
>()("desktop/DesktopConfig") {}

export type DesktopConfigInputs = {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly devUrl: string | undefined;
};

export function resolveServerEntry(isPackaged: boolean, resourcesPath: string): string {
  if (isPackaged) {
    return path.join(
      resourcesPath,
      "app.asar",
      "node_modules",
      "@getpie",
      "server",
      "dist",
      "server.mjs",
    );
  }
  return url.fileURLToPath(new URL("../../../../packages/server/dist/server.mjs", import.meta.url));
}

/**
 * Packaged desktop ships Bun and a bun-build of pi-rpc in extraResources.
 * Point the Pi child at that pair; launch-time PIE_* wins.
 */
export function applyPackagedPiRuntime(
  env: NodeJS.ProcessEnv,
  options: {
    readonly isPackaged: boolean;
    readonly bundledBun: string | undefined;
    readonly bundledRpc: string | undefined;
  },
): NodeJS.ProcessEnv {
  if (!options.isPackaged || options.bundledBun === undefined) return env;

  const next: NodeJS.ProcessEnv = { ...env, PIE_BUN: env.PIE_BUN ?? options.bundledBun };
  if (options.bundledRpc !== undefined) {
    next.PIE_PI_EXECUTABLE = env.PIE_PI_EXECUTABLE ?? options.bundledRpc;
  }
  return next;
}

export function buildDesktopConfig(inputs: DesktopConfigInputs): DesktopConfig["Service"] {
  return {
    isPackaged: inputs.isPackaged,
    devUrl: inputs.devUrl,
    serverEntry: resolveServerEntry(inputs.isPackaged, inputs.resourcesPath),
    resourcesPath: inputs.resourcesPath,
  };
}

export function makeDesktopConfigLive(inputs: DesktopConfigInputs): Layer.Layer<DesktopConfig> {
  return Layer.succeed(DesktopConfig, buildDesktopConfig(inputs));
}
