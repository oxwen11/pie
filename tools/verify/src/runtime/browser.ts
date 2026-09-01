import { VerifyError } from "./fail.ts";
import { writeText } from "./fs.ts";
import { commandOnPath, runCommand, runCommandInherit } from "./process.ts";

export type AgentBrowserTarget = {
  session?: string;
  cdpPort?: number;
  defaultOpenUrl?: string;
};

export type AgentBrowserOptions = AgentBrowserTarget & {
  outputPath?: string;
};

export function requireAgentBrowser(): string {
  const resolved = commandOnPath("agent-browser");
  if (resolved === undefined) {
    throw new Error(
      "agent-browser is not on PATH — install it once, then drive via `pie-verify web|desktop browser`",
    );
  }
  return resolved;
}

export function buildAgentBrowserArgv(args: string[], target: AgentBrowserTarget = {}): string[] {
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
  const resolved = requireAgentBrowser();
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

export function forwardAgentBrowser(args: string[], target: AgentBrowserTarget): void {
  const resolved = requireAgentBrowser();
  const argv = buildAgentBrowserArgv(args, target);
  const status = runCommandInherit(resolved, argv);
  if (status !== 0) {
    throw new VerifyError(`agent-browser exited ${status}`, status);
  }
}
