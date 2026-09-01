import fs from "node:fs";
import module from "node:module";
import path from "node:path";

import { VerifyError } from "./fail.ts";
import { writeText } from "./fs.ts";
import { commandOnPath, runCommand, runCommandInherit } from "./process.ts";

const require = module.createRequire(import.meta.url);

export type AgentBrowserTarget = {
  session?: string;
  cdpPort?: number;
  defaultOpenUrl?: string;
};

export type AgentBrowserOptions = AgentBrowserTarget & {
  outputPath?: string;
};

export function browserNeedsIsolation(command: string | undefined): boolean {
  switch (command) {
    case "install":
    case "skills":
    case "--version":
    case "-v":
    case "-V":
    case "version":
    case undefined:
      return false;
    default:
      return true;
  }
}

export function resolveAgentBrowserBin(): string {
  const override = process.env.VERIFY_PIE_AGENT_BROWSER;
  if (override !== undefined && override !== "") {
    return override;
  }
  try {
    const pkgPath = require.resolve("agent-browser/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["agent-browser"];
    if (rel === undefined) {
      throw new Error("agent-browser package.json has no bin");
    }
    return path.resolve(path.dirname(pkgPath), rel);
  } catch (error) {
    const onPath = commandOnPath("agent-browser");
    if (onPath !== undefined) {
      return onPath;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `agent-browser is a dependency of @getpie/verify — run pnpm install (${detail})`,
      { cause: error },
    );
  }
}

export function buildAgentBrowserArgv(args: string[], target: AgentBrowserTarget = {}): string[] {
  if (!browserNeedsIsolation(args[0])) {
    return [...args];
  }
  const forwarded = [...args];
  if (forwarded[0] === "open" && forwarded.length === 1 && target.defaultOpenUrl !== undefined) {
    forwarded.push(target.defaultOpenUrl);
  }
  const argv: string[] = [];
  if (target.session !== undefined) {
    argv.push("--session", target.session);
  }
  if (target.cdpPort !== undefined) {
    argv.push("--cdp", String(target.cdpPort));
  }
  argv.push(...forwarded);
  return argv;
}

export function agentBrowser(args: string[], options: AgentBrowserOptions = {}): string {
  const resolved = resolveAgentBrowserBin();
  const argv = buildAgentBrowserArgv(args, options);
  const result = runCommand(resolved, argv);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `agent-browser ${argv.join(" ")} failed`);
  }
  if (options.outputPath !== undefined) {
    writeText(options.outputPath, result.stdout);
  }
  return result.stdout;
}

export function saveScreenshot(dest: string, name: string, target: AgentBrowserTarget): string {
  const destPath = path.join(dest, `${name}.png`);
  agentBrowser(["screenshot", destPath], target);
  return destPath;
}

export function saveSnapshot(dest: string, name: string, target: AgentBrowserTarget): string {
  const destPath = path.join(dest, `${name}.txt`);
  agentBrowser(["snapshot"], { ...target, outputPath: destPath });
  return destPath;
}

export function forwardAgentBrowser(args: string[], target: AgentBrowserTarget): void {
  const resolved = resolveAgentBrowserBin();
  const argv = buildAgentBrowserArgv(args, target);
  const status = runCommandInherit(resolved, argv);
  if (status !== 0) {
    throw new VerifyError(`agent-browser exited ${status}`, status);
  }
}
