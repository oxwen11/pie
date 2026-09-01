import fs from "node:fs";
import path from "node:path";

import { CURRENT_LINK, ROOT, SKILL_DIR } from "./config.ts";
import { invokePie, readDaemonRecord } from "./runtime/daemon.ts";
import {
  clearCurrentRun,
  currentRun,
  isUnder,
  readJsonField,
  readText,
  realPath,
  removePath,
  tryReadJsonField,
} from "./runtime/fs.ts";
import { killTree, pidAlive, readPidFile, waitDead } from "./runtime/process.ts";

export async function cleanup(args: string[]): Promise<void> {
  const runDir = resolveCleanupTarget(args[0]);
  if (runDir === undefined) {
    console.log("verify-pie-cli: no current run to clean up");
    return;
  }

  const meta = path.join(runDir, "meta.json");
  const mode = fs.existsSync(meta) ? tryReadJsonField<string>(meta, "mode") : undefined;

  if (mode === "serve") {
    const servePid = readPidFile(path.join(runDir, "pids/serve.pid"));
    console.log(`verify-pie-cli: stopping serve pid=${servePid ?? "none"}`);
    killTree(servePid);
    await waitDead(servePid);
  } else if (fs.existsSync(meta)) {
    const repo = readJsonField<string>(meta, "repo");
    const env = {
      ...process.env,
      PIE_HOME: readJsonField<string>(meta, "pieHome"),
      PIE_DAEMON_DIR: readJsonField<string>(meta, "daemonDir"),
      PIE_PORT: String(readJsonField<number>(meta, "piePort")),
      NODE_ENV: "development",
    };
    const recordPath = path.join(env.PIE_DAEMON_DIR, "daemon.pid");
    const daemonPid = fs.existsSync(recordPath) ? readDaemonRecord(recordPath).pid : undefined;
    console.log(`verify-pie-cli: pie daemon stop (recorded pid=${daemonPid ?? "none"})`);
    invokePie(repo, ["daemon", "stop"], env, { logPath: path.join(runDir, "logs/cli-stop.log") });
    const stopLog = path.join(runDir, "logs/cli-stop.log");
    if (fs.existsSync(stopLog)) {
      process.stdout.write(readText(stopLog));
    }
    if (daemonPid !== undefined && pidAlive(daemonPid)) {
      console.log(
        `verify-pie-cli: daemon still alive after stop; killing recorded pid ${daemonPid}`,
      );
      killTree(daemonPid);
      await waitDead(daemonPid);
    }
  }

  if (isUnder(path.join(ROOT, "runs"), runDir)) {
    removePath(runDir);
    console.log(`verify-pie-cli: removed ${runDir}`);
  }
  clearCurrentRun(CURRENT_LINK, runDir);
  console.log(`verify-pie-cli: cleanup done (evidence kept under ${SKILL_DIR}/evidence/)`);
}

function resolveCleanupTarget(explicit: string | undefined): string | undefined {
  return currentRun(CURRENT_LINK) ?? (explicit === undefined ? undefined : realPath(explicit));
}
