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
  if (isPackaged) return path.join(resourcesPath, "server", "server.mjs");
  return url.fileURLToPath(new URL("../../../../packages/server/dist/server.mjs", import.meta.url));
}

/** Desktop always runs its daemon with Bun; packaged builds prefer the shipped binary. */
export function applyDesktopRuntime(
  env: NodeJS.ProcessEnv,
  options: {
    readonly isPackaged: boolean;
    readonly bundledBun: string | undefined;
    readonly bundledPiProcess: string | undefined;
  },
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, PIE_DAEMON_RUNTIME: "bun" };
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
