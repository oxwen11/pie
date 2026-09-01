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
  switch (identity.id) {
    case "cli":
    case "desktop": {
      const recordPath = path.join(runDir, "pie-home/daemon/daemon.pid");
      if (fs.existsSync(recordPath)) {
        pids.push(readDaemonRecord(recordPath).pid);
      }
      break;
    }
    case "web":
      break;
    default: {
      const exhaustive: never = identity;
      void exhaustive;
    }
  }
  return pids;
}
