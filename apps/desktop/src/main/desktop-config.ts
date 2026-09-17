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

export function startsDesktopInBackground(env: NodeJS.ProcessEnv): boolean {
  return env["PIE_E2E"] === "1" || env["PIE_DESKTOP_BACKGROUND"] === "1";
}

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
 * Packaged builds ship Bun for pie-pi-process only (`PIE_BUN` /
 * `PIE_PI_EXECUTABLE`); launch-time PIE_* wins. The daemon is always Node.
 */
export function applyDesktopRuntime(
  env: NodeJS.ProcessEnv,
  options: {
    readonly isPackaged: boolean;
    readonly bundledBun: string | undefined;
    readonly bundledPiProcess: string | undefined;
  },
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  if (!options.isPackaged || options.bundledBun === undefined) return next;

  next.PIE_BUN = env.PIE_BUN ?? options.bundledBun;
  if (options.bundledPiProcess !== undefined) {
    next.PIE_PI_EXECUTABLE = env.PIE_PI_EXECUTABLE ?? options.bundledPiProcess;
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
