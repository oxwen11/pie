import { join } from "node:path";
import { ensureCoreBuilt, invokePie, resolveCompatKey } from "../../verify-runtime/src/daemon.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { findRepoRoot } from "../../verify-runtime/src/process.ts";
import { CURRENT_LINK } from "./config.ts";

export async function run(args: string[]): Promise<void> {
  const repo = findRepoRoot();
  ensureCoreBuilt(repo);
  const runDir = currentRun(CURRENT_LINK);
  const helpOnly = isHelpOrVersion(args);
  if (runDir === undefined && !helpOnly) {
    throw new Error("no current run. Launch first.");
  }

  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
  if (runDir !== undefined) {
    const meta = join(runDir, "meta.json");
    env.PIE_HOME = readJsonField<string>(meta, "pieHome");
    env.PIE_DAEMON_DIR = readJsonField<string>(meta, "daemonDir");
    env.PIE_PORT = String(readJsonField<number>(meta, "piePort"));
    env.PIE_DAEMON_COMPATIBILITY_KEY =
      process.env.PIE_DAEMON_COMPATIBILITY_KEY ?? (await resolveCompatKey(repo));
  }

  const result = invokePie(repo, args, env, { inherit: true });
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function isHelpOrVersion(args: string[]): boolean {
  return args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v");
}
