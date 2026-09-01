import fs from "node:fs";
import path from "node:path";

import type { SurfaceIdentity } from "../identity.ts";
import { readDaemonRecord } from "../runtime/daemon.ts";
import { readPidFile } from "../runtime/process.ts";

export function recordedPids(identity: SurfaceIdentity, runDir: string): number[] {
  const pids: number[] = [];
  for (const rel of identity.pidFiles) {
    const pid = readPidFile(path.join(runDir, rel));
    if (pid !== undefined) {
      pids.push(pid);
    }
  }
  if (identity.usesDaemonDir) {
    const recordPath = path.join(runDir, "pie-home/daemon/daemon.pid");
    if (fs.existsSync(recordPath)) {
      pids.push(readDaemonRecord(recordPath).pid);
    }
  }
  return pids;
}
