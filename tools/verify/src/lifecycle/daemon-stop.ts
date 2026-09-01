import fs from "node:fs";
import path from "node:path";

import { invokePie, readDaemonRecord } from "../runtime/daemon.ts";
import { readText } from "../runtime/fs.ts";
import { killTree, pidAlive, waitDead } from "../runtime/process.ts";

export async function stopRecordedDaemon(input: {
  repo: string;
  pieHome: string;
  daemonDir: string;
  piePort: number;
  runDir: string;
  logPrefix: string;
}): Promise<void> {
  const env = {
    ...process.env,
    PIE_HOME: input.pieHome,
    PIE_DAEMON_DIR: input.daemonDir,
    PIE_PORT: String(input.piePort),
    NODE_ENV: "development",
  };
  const recordPath = path.join(input.daemonDir, "daemon.pid");
  const daemonPid = fs.existsSync(recordPath) ? readDaemonRecord(recordPath).pid : undefined;
  console.log(`${input.logPrefix}: pie daemon stop (recorded pid=${daemonPid ?? "none"})`);
  invokePie(input.repo, ["daemon", "stop"], env, {
    logPath: path.join(input.runDir, "logs/cli-stop.log"),
  });
  const stopLog = path.join(input.runDir, "logs/cli-stop.log");
  if (fs.existsSync(stopLog)) {
    process.stdout.write(readText(stopLog));
  }
  if (daemonPid !== undefined && pidAlive(daemonPid)) {
    console.log(
      `${input.logPrefix}: daemon still alive after stop; killing recorded pid ${daemonPid}`,
    );
    killTree(daemonPid);
    await waitDead(daemonPid);
  }
}
