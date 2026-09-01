import { join } from "node:path";
import { ensureCoreBuilt, invokePie, resolveCompatKey } from "../../verify-runtime/src/daemon.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { findRepoRoot } from "../../verify-runtime/src/process.ts";
import { CURRENT_LINK } from "./config.ts";

export async function run(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error("no current run. Launch first.");
  }
  const repo = findRepoRoot();
  ensureCoreBuilt(repo);
  const meta = join(runDir, "meta.json");
  const env = {
    ...process.env,
    PIE_HOME: readJsonField<string>(meta, "pieHome"),
    PIE_DAEMON_DIR: readJsonField<string>(meta, "daemonDir"),
    PIE_PORT: String(readJsonField<number>(meta, "piePort")),
    NODE_ENV: "development",
    PIE_DAEMON_COMPATIBILITY_KEY: process.env.PIE_DAEMON_COMPATIBILITY_KEY ?? (await resolveCompatKey(repo)),
  };
  const result = invokePie(repo, args, env, { inherit: true });
  if (result.status !== 0) {
    process.exit(result.status);
  }
}
