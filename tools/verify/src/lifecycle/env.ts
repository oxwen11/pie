import fs from "node:fs";
import path from "node:path";

import { DESKTOP, WEB, type SurfaceIdentity } from "../identity.ts";
import { expectMeta, readRunMeta } from "../meta.ts";
import {
  formatBrowserEnv,
  resolveAgentBrowserBin,
  resolveBrowserEnv,
  type BrowserEnvVars,
} from "../runtime/browser.ts";
import { VerifyError } from "../runtime/fail.ts";
import { currentRun, writeText } from "../runtime/fs.ts";
import { runCommandInherit } from "../runtime/process.ts";
import type { Surface } from "../surface.ts";

export function parseEnvArgs(args: string[]) {
  let exportMode = false;
  for (const arg of args) {
    switch (arg) {
      case "--export":
        exportMode = true;
        break;
      default:
        throw new VerifyError(
          `unknown arg ${arg}\n  usage: pie-verify <web|desktop> env [--export]`,
          2,
        );
    }
  }
  return { exportMode };
}

export function browserEnvForRun(identity: SurfaceIdentity, runDir: string): BrowserEnvVars {
  switch (identity.id) {
    case "cli":
      throw new VerifyError(
        `${identity.bin} has no browser — this surface is pie / pie daemon / pie serve. Drive UI with \`pie-verify web env\` or \`pie-verify desktop env\`.`,
        2,
      );
    case "web": {
      const web = expectMeta(readRunMeta(path.join(runDir, "meta.json")), "web");
      return resolveBrowserEnv({ session: identity.browserSession, appUrl: web.appUrl });
    }
    case "desktop": {
      const desktop = expectMeta(readRunMeta(path.join(runDir, "meta.json")), "desktop");
      return resolveBrowserEnv({
        session: identity.browserSession,
        cdpPort: desktop.cdpPort,
      });
    }
    default: {
      const exhaustive: never = identity;
      void exhaustive;
      throw new Error("unknown surface");
    }
  }
}

export function writeBrowserEnvFile(identity: SurfaceIdentity, runDir: string): void {
  if (identity.id === "cli") {
    return;
  }
  writeText(
    path.join(runDir, "agent-browser.env"),
    formatBrowserEnv(browserEnvForRun(identity, runDir), "export"),
  );
  writeIsolationShim(identity);
}

export function writeIsolationShim(
  identity: Extract<SurfaceIdentity, { id: "web" | "desktop" }>,
): void {
  const envFile = path.join(identity.currentLink, "agent-browser.env");
  const dest = path.join(identity.root, "bin/agent-browser");
  writeText(
    dest,
    `#!/bin/sh
set -eu
env_file=${JSON.stringify(envFile)}
if [ ! -f "$env_file" ]; then
  echo "pie-verify: no current ${identity.id} run. Launch first: ${identity.bin} launch" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$env_file"
exec "$AGENT_BROWSER" "$@"
`,
  );
  fs.chmodSync(dest, 0o755);
}

export type ActiveBrowserEnvInput = {
  surface?: string;
  webRun?: string | undefined;
  desktopRun?: string | undefined;
};

function parseSurfaceOverride(value: string | undefined): "web" | "desktop" | undefined {
  switch (value) {
    case "web":
    case "desktop":
      return value;
    case undefined:
    case "":
      return undefined;
    default:
      throw new VerifyError(`PIE_VERIFY_SURFACE must be web or desktop, got ${value}`, 2);
  }
}

export function resolveActiveBrowserEnv(
  input: ActiveBrowserEnvInput = {},
): BrowserEnvVars | undefined {
  const surface = parseSurfaceOverride(input.surface ?? process.env.PIE_VERIFY_SURFACE);
  const webRun = input.webRun !== undefined ? input.webRun : currentRun(WEB.currentLink);
  const desktopRun =
    input.desktopRun !== undefined ? input.desktopRun : currentRun(DESKTOP.currentLink);
  if (surface === "web") {
    if (webRun === undefined) {
      throw new Error(`no current run. Launch first: ${WEB.bin} launch`);
    }
    return browserEnvForRun(WEB, webRun);
  }
  if (surface === "desktop") {
    if (desktopRun === undefined) {
      throw new Error(`no current run. Launch first: ${DESKTOP.bin} launch`);
    }
    return browserEnvForRun(DESKTOP, desktopRun);
  }
  if (webRun !== undefined && desktopRun !== undefined) {
    throw new VerifyError(
      "web and desktop runs are both current. Set PIE_VERIFY_SURFACE=web|desktop, or clean up one surface.",
      2,
    );
  }
  if (webRun !== undefined) {
    return browserEnvForRun(WEB, webRun);
  }
  if (desktopRun !== undefined) {
    return browserEnvForRun(DESKTOP, desktopRun);
  }
  return undefined;
}

export function execIsolatedAgentBrowser(args: string[]): void {
  if (process.env.VERIFY_PIE_RAW_AGENT_BROWSER === "1") {
    const status = runCommandInherit(resolveAgentBrowserBin(), args);
    if (status !== 0) {
      throw new VerifyError(`agent-browser exited ${status}`, status);
    }
    return;
  }
  const active = resolveActiveBrowserEnv();
  const real = resolveAgentBrowserBin();
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_BROWSER: real };
  if (active !== undefined) {
    env.AGENT_BROWSER_SESSION = active.AGENT_BROWSER_SESSION;
    if (active.AGENT_BROWSER_CDP !== undefined) {
      env.AGENT_BROWSER_CDP = active.AGENT_BROWSER_CDP;
    } else {
      delete env.AGENT_BROWSER_CDP;
    }
    if (active.PIE_VERIFY_APP_URL !== undefined) {
      env.PIE_VERIFY_APP_URL = active.PIE_VERIFY_APP_URL;
    }
  }
  const status = runCommandInherit(real, args, { env });
  if (status !== 0) {
    throw new VerifyError(`agent-browser exited ${status}`, status);
  }
}

export function driveHintLines(
  identity: Extract<SurfaceIdentity, { id: "web" | "desktop" }>,
): string[] {
  switch (identity.id) {
    case "web":
      return [
        `  drive   agent-browser open http://localhost:4190/`,
        `          (or ${path.join(identity.root, "bin/agent-browser")})`,
      ];
    case "desktop":
      return [
        `  drive   agent-browser get title`,
        `          (or ${path.join(identity.root, "bin/agent-browser")})`,
      ];
    default: {
      const exhaustive: never = identity;
      void exhaustive;
      return [];
    }
  }
}

export function printEnv(surface: Surface, args: string[]): void {
  const { identity } = surface;
  if (identity.id === "cli") {
    throw new VerifyError(
      `${identity.bin} has no browser — this surface is pie / pie daemon / pie serve. Drive UI with \`pie-verify web env\` or \`pie-verify desktop env\`.`,
      2,
    );
  }
  const { exportMode } = parseEnvArgs(args);
  const runDir = currentRun(identity.currentLink);
  if (runDir === undefined) {
    throw new Error(`no current run. Launch first: ${identity.bin} launch`);
  }
  process.stdout.write(
    formatBrowserEnv(browserEnvForRun(identity, runDir), exportMode ? "export" : "plain"),
  );
}
