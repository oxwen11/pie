import fs from "node:fs";
import path from "node:path";

import { invokePie, readDaemonRecord } from "../../runtime/daemon.ts";
import {
  clearCurrentRun,
  currentRun,
  isUnder,
  readJsonField,
  readText,
  realPath,
  removePath,
  tryReadJsonField,
} from "../../runtime/fs.ts";
import { killTree, pidAlive, readPidFile, waitDead } from "../../runtime/process.ts";
import { removeScaffold } from "../../runtime/scaffold.ts";
import { CURRENT_LINK, ROOT, SAMPLE_MARKER, SAMPLE_NAME, SKILL_DIR } from "./config.ts";

export async function cleanup(args: string[]): Promise<void> {
  const runDir =
    currentRun(CURRENT_LINK) ?? (args[0] === undefined ? undefined : realPath(args[0]));
  if (runDir === undefined) {
    console.log("verify-pie-desktop: no current run to clean up");
    return;
  }

  const meta = path.join(runDir, "meta.json");
  const evPid = readPidFile(path.join(runDir, "pids/electron-vite.pid"));
  console.log(`verify-pie-desktop: stopping electron-vite pid=${evPid ?? "none"}`);
  killTree(evPid);
  await waitDead(evPid);

  if (fs.existsSync(meta)) {
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
    console.log(`verify-pie-desktop: pie daemon stop (recorded pid=${daemonPid ?? "none"})`);
    invokePie(repo, ["daemon", "stop"], env, { logPath: path.join(runDir, "logs/cli-stop.log") });
    const stopLog = path.join(runDir, "logs/cli-stop.log");
    if (fs.existsSync(stopLog)) {
      process.stdout.write(readText(stopLog));
    }
    if (daemonPid !== undefined && pidAlive(daemonPid)) {
      console.log(
        `verify-pie-desktop: daemon still alive after stop; killing recorded pid ${daemonPid}`,
      );
      killTree(daemonPid);
      await waitDead(daemonPid);
    }
    removeScaffold(
      tryReadJsonField<string>(meta, "sampleProject"),
      SAMPLE_MARKER,
      "verify-pie-desktop",
    );
    const userData = tryReadJsonField<string>(meta, "userData");
    if (userData?.includes("/pie-desktop-remote-debugging-") === true) {
      removePath(userData);
      console.log(`verify-pie-desktop: removed ${userData}`);
    }
  }
  removeScaffold(
    path.join(process.env.HOME ?? "", SAMPLE_NAME),
    SAMPLE_MARKER,
    "verify-pie-desktop",
  );

  if (isUnder(path.join(ROOT, "runs"), runDir)) {
    removePath(runDir);
    console.log(`verify-pie-desktop: removed ${runDir}`);
  }
  clearCurrentRun(CURRENT_LINK, runDir);
  console.log(`verify-pie-desktop: cleanup done (evidence kept under ${SKILL_DIR}/evidence/)`);
}
