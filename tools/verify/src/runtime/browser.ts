import path from "node:path";

import { VerifyError } from "./fail.ts";
import { writeText } from "./fs.ts";
import { commandOnPath, findRepoRoot, runCommand, runCommandInherit } from "./process.ts";

export type AgentBrowserTarget = {
  session?: string;
  cdpPort?: number;
};

export type AgentBrowserOptions = AgentBrowserTarget & {
  outputPath?: string;
};

export type BrowserEnvVars = {
  AGENT_BROWSER: string;
  AGENT_BROWSER_SESSION: string;
  AGENT_BROWSER_CDP?: string;
  PIE_VERIFY_APP_URL?: string;
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
  const mise = commandOnPath("mise");
  if (mise !== undefined) {
    const result = runCommand(mise, ["which", "agent-browser"], { cwd: findRepoRoot() });
    const resolved = result.stdout.trim();
    if (result.status === 0 && resolved !== "") {
      return resolved;
    }
  }
  throw new Error("agent-browser is a mise tool — run mise install");
}

export function buildAgentBrowserArgv(args: string[], target: AgentBrowserTarget = {}): string[] {
  if (!browserNeedsIsolation(args[0])) {
    return [...args];
  }
  const argv: string[] = [];
  if (target.session !== undefined) {
    argv.push("--session", target.session);
  }
  if (target.cdpPort !== undefined) {
    argv.push("--cdp", String(target.cdpPort));
  }
  argv.push(...args);
  return argv;
}

export function resolveBrowserEnv(
  target: AgentBrowserTarget & { appUrl?: string },
): BrowserEnvVars {
  const env: BrowserEnvVars = {
    AGENT_BROWSER: resolveAgentBrowserBin(),
    AGENT_BROWSER_SESSION: target.session ?? "",
  };
  if (target.cdpPort !== undefined) {
    env.AGENT_BROWSER_CDP = String(target.cdpPort);
  }
  if (target.appUrl !== undefined && target.appUrl !== "") {
    env.PIE_VERIFY_APP_URL = target.appUrl;
  }
  return env;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const BROWSER_ENV_KEYS = [
  "AGENT_BROWSER",
  "AGENT_BROWSER_SESSION",
  "AGENT_BROWSER_CDP",
  "PIE_VERIFY_APP_URL",
] as const;

export function formatBrowserEnv(vars: BrowserEnvVars, mode: "plain" | "export"): string {
  const lines: string[] = [];
  for (const key of BROWSER_ENV_KEYS) {
    const value = vars[key];
    if (value === undefined || value === "") {
      continue;
    }
    lines.push(mode === "export" ? `export ${key}=${shellQuote(value)}` : `${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
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
