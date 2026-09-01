import { existsSync } from "node:fs";
import { join } from "node:path";
import { invokePie, readDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { clearCurrentRun, currentRun, isUnder, readJsonField, readText, realPath, removePath, tryReadJsonField } from "../../verify-runtime/src/fs.ts";
import { killTree, pidAlive, readPidFile, waitDead } from "../../verify-runtime/src/process.ts";
import { CURRENT_LINK, ROOT, SKILL_DIR } from "./config.ts";

export async function cleanup(args: string[]): Promise<void> {
  const runDir = resolveCleanupTarget(args[0]);
  if (runDir === undefined) {
    console.log("verify-pie-cli: no current run to clean up");
    return;
  }

  const meta = join(runDir, "meta.json");
  const mode = existsSync(meta) ? tryReadJsonField<string>(meta, "mode") : undefined;

  if (mode === "serve") {
    const servePid = readPidFile(join(runDir, "pids/serve.pid"));
    console.log(`verify-pie-cli: stopping serve pid=${servePid ?? "none"}`);
    killTree(servePid);
    await waitDead(servePid);
  } else if (existsSync(meta)) {
    const repo = readJsonField<string>(meta, "repo");
    const env = {
      ...process.env,
      PIE_HOME: readJsonField<string>(meta, "pieHome"),
      PIE_DAEMON_DIR: readJsonField<string>(meta, "daemonDir"),
      PIE_PORT: String(readJsonField<number>(meta, "piePort")),
      NODE_ENV: "development",
    };
    const recordPath = join(env.PIE_DAEMON_DIR, "daemon.pid");
    const daemonPid = existsSync(recordPath) ? readDaemonRecord(recordPath).pid : undefined;
    console.log(`verify-pie-cli: pie daemon stop (recorded pid=${daemonPid ?? "none"})`);
    invokePie(repo, ["daemon", "stop"], env, { logPath: join(runDir, "logs/cli-stop.log") });
    const stopLog = join(runDir, "logs/cli-stop.log");
    if (existsSync(stopLog)) {
      process.stdout.write(readText(stopLog));
    }
    if (daemonPid !== undefined && pidAlive(daemonPid)) {
      console.log(`verify-pie-cli: daemon still alive after stop; killing recorded pid ${daemonPid}`);
      killTree(daemonPid);
      await waitDead(daemonPid);
    }
  }

  if (isUnder(join(ROOT, "runs"), runDir)) {
    removePath(runDir);
    console.log(`verify-pie-cli: removed ${runDir}`);
  }
  clearCurrentRun(CURRENT_LINK, runDir);
  console.log(`verify-pie-cli: cleanup done (evidence kept under ${SKILL_DIR}/evidence/)`);
}

function resolveCleanupTarget(explicit: string | undefined): string | undefined {
  return currentRun(CURRENT_LINK) ?? (explicit === undefined ? undefined : realPath(explicit));
}
