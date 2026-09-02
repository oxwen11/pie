import fs from "node:fs";
import path from "node:path";

import { VerifyError } from "./fail.ts";
import { ensureDir, writeText } from "./fs.ts";
import { commandOnPath, findRepoRoot, runCommand, runCommandInherit } from "./process.ts";

export type AgentBrowserTarget = {
  session?: string;
  cdpPort?: number;
};

export type AgentBrowserOptions = AgentBrowserTarget & {
  outputPath?: string;
};

export type BrowserEnvInput = AgentBrowserTarget & {
  appUrl?: string;
  runDir: string;
};

export type BrowserEnvVars = {
  AGENT_BROWSER: string;
  AGENT_BROWSER_CONFIG: string;
  AGENT_BROWSER_SESSION: string;
  AGENT_BROWSER_NAMESPACE: string;
  AGENT_BROWSER_SOCKET_DIR: string;
  AGENT_BROWSER_SCREENSHOT_DIR: string;
  AGENT_BROWSER_DOWNLOAD_PATH: string;
  AGENT_BROWSER_IDLE_TIMEOUT_MS: string;
  AGENT_BROWSER_DEFAULT_TIMEOUT: string;
  AGENT_BROWSER_CDP?: string;
  AGENT_BROWSER_PIN_TAB?: string;
  AGENT_BROWSER_EXECUTABLE_PATH?: string;
  AGENT_BROWSER_ARGS?: string;
  PIE_VERIFY_APP_URL?: string;
};

export const BROWSER_ENV_KEYS = [
  "AGENT_BROWSER",
  "AGENT_BROWSER_CONFIG",
  "AGENT_BROWSER_SESSION",
  "AGENT_BROWSER_NAMESPACE",
  "AGENT_BROWSER_SOCKET_DIR",
  "AGENT_BROWSER_CDP",
  "AGENT_BROWSER_PIN_TAB",
  "AGENT_BROWSER_EXECUTABLE_PATH",
  "AGENT_BROWSER_ARGS",
  "AGENT_BROWSER_SCREENSHOT_DIR",
  "AGENT_BROWSER_DOWNLOAD_PATH",
  "AGENT_BROWSER_IDLE_TIMEOUT_MS",
  "AGENT_BROWSER_DEFAULT_TIMEOUT",
  "PIE_VERIFY_APP_URL",
] as const;

/** Parent-shell leaks that break isolated launch or CDP attach. */
export const BROWSER_ENV_UNSET = [
  "AGENT_BROWSER_AUTO_CONNECT",
  "AGENT_BROWSER_PROFILE",
  "AGENT_BROWSER_RESTORE",
  "AGENT_BROWSER_STATE",
  "AGENT_BROWSER_ALLOWED_DOMAINS",
  "AGENT_BROWSER_WEBGPU",
] as const;

const CHROME_CANDIDATES = [
  "/opt/google/chrome/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
] as const;

const WEB_CHROME_ARGS = "--no-sandbox,--disable-dev-shm-usage";

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

export function agentBrowserIsolation(runDir: string) {
  const root = path.join(runDir, "agent-browser");
  return {
    root,
    socketDir: path.join(root, "sockets"),
    screenshotDir: path.join(root, "screenshots"),
    downloadPath: path.join(root, "downloads"),
    configPath: path.join(runDir, "agent-browser.json"),
  };
}

export function resolveIsolatedChromeExecutable(): string | undefined {
  const override = process.env.VERIFY_PIE_CHROME;
  if (override !== undefined && override !== "") {
    return override;
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (isExecutable(candidate) && !isRemoteDebugWrapper(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isRemoteDebugWrapper(filePath: string): boolean {
  try {
    const head = fs.readFileSync(filePath, "utf8").slice(0, 8192);
    return head.startsWith("#!") && head.includes("remote-debugging-port");
  } catch {
    return false;
  }
}

export function resolveBrowserEnv(input: BrowserEnvInput): BrowserEnvVars {
  const isolation = agentBrowserIsolation(input.runDir);
  const session = input.session ?? "";
  const env: BrowserEnvVars = {
    AGENT_BROWSER: resolveAgentBrowserBin(),
    AGENT_BROWSER_CONFIG: isolation.configPath,
    AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_NAMESPACE: session,
    AGENT_BROWSER_SOCKET_DIR: isolation.socketDir,
    AGENT_BROWSER_SCREENSHOT_DIR: isolation.screenshotDir,
    AGENT_BROWSER_DOWNLOAD_PATH: isolation.downloadPath,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: "0",
    AGENT_BROWSER_DEFAULT_TIMEOUT: "40000",
  };
  if (input.cdpPort !== undefined) {
    env.AGENT_BROWSER_CDP = String(input.cdpPort);
    env.AGENT_BROWSER_PIN_TAB = "true";
  } else {
    const chrome = resolveIsolatedChromeExecutable();
    if (chrome !== undefined) {
      env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
    }
    env.AGENT_BROWSER_ARGS = WEB_CHROME_ARGS;
  }
  if (input.appUrl !== undefined && input.appUrl !== "") {
    env.PIE_VERIFY_APP_URL = input.appUrl;
  }
  return env;
}

export type AgentBrowserConfig = {
  session: string;
  namespace: string;
  socketDir: string;
  idleTimeout: string;
  timeout: string;
  screenshotDir: string;
  downloadPath: string;
  cdp?: string;
  pinTab?: boolean;
  executablePath?: string;
  chromeArgs?: string[];
};

export function browserConfigForEnv(vars: BrowserEnvVars): AgentBrowserConfig {
  const config: AgentBrowserConfig = {
    session: vars.AGENT_BROWSER_SESSION,
    namespace: vars.AGENT_BROWSER_NAMESPACE,
    socketDir: vars.AGENT_BROWSER_SOCKET_DIR,
    idleTimeout: vars.AGENT_BROWSER_IDLE_TIMEOUT_MS,
    timeout: vars.AGENT_BROWSER_DEFAULT_TIMEOUT,
    screenshotDir: vars.AGENT_BROWSER_SCREENSHOT_DIR,
    downloadPath: vars.AGENT_BROWSER_DOWNLOAD_PATH,
  };
  if (vars.AGENT_BROWSER_CDP !== undefined) {
    config.cdp = vars.AGENT_BROWSER_CDP;
    config.pinTab = true;
  }
  if (vars.AGENT_BROWSER_EXECUTABLE_PATH !== undefined) {
    config.executablePath = vars.AGENT_BROWSER_EXECUTABLE_PATH;
  }
  if (vars.AGENT_BROWSER_ARGS !== undefined) {
    config.chromeArgs = vars.AGENT_BROWSER_ARGS.split(",");
  }
  return config;
}

export function ensureBrowserEnvDirs(vars: BrowserEnvVars): void {
  ensureDir(vars.AGENT_BROWSER_SOCKET_DIR);
  ensureDir(vars.AGENT_BROWSER_SCREENSHOT_DIR);
  ensureDir(vars.AGENT_BROWSER_DOWNLOAD_PATH);
}

export function applyBrowserEnv(vars: BrowserEnvVars, env: NodeJS.ProcessEnv): void {
  for (const key of BROWSER_ENV_UNSET) {
    delete env[key];
  }
  for (const key of BROWSER_ENV_KEYS) {
    const value = vars[key];
    if (value === undefined || value === "") {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
}

function isolationUnsets(vars: BrowserEnvVars): string[] {
  const keys = [...BROWSER_ENV_UNSET];
  for (const key of BROWSER_ENV_KEYS) {
    const value = vars[key];
    if (value === undefined || value === "") {
      keys.push(key);
    }
  }
  return keys;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function formatBrowserEnv(vars: BrowserEnvVars, mode: "plain" | "export"): string {
  const lines: string[] = [];
  if (mode === "export") {
    for (const key of isolationUnsets(vars)) {
      lines.push(`unset ${key}`);
    }
  }
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
