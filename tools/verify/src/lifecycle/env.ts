import path from "node:path";

import type { SurfaceIdentity } from "../identity.ts";
import { expectMeta, readRunMeta } from "../meta.ts";
import { formatBrowserEnv, resolveBrowserEnv, type BrowserEnvVars } from "../runtime/browser.ts";
import { VerifyError } from "../runtime/fail.ts";
import { currentRun, writeText } from "../runtime/fs.ts";
import type { Surface } from "../surface.ts";

export function parseEnvArgs(args: string[]): { exportMode: boolean } {
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
}

export function driveHintLines(
  identity: Extract<SurfaceIdentity, { id: "web" | "desktop" }>,
): string[] {
  const evalLine = `  env     ${identity.bin} env --export`;
  switch (identity.id) {
    case "web":
      return [
        evalLine,
        `  drive   eval "$(${identity.bin} env --export)"`,
        `          "$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" open "$PIE_VERIFY_APP_URL"`,
      ];
    case "desktop":
      return [
        evalLine,
        `  drive   eval "$(${identity.bin} env --export)"`,
        `          "$AGENT_BROWSER" --session "$AGENT_BROWSER_SESSION" --cdp "$AGENT_BROWSER_CDP" connect "$AGENT_BROWSER_CDP"`,
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
