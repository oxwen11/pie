import { existsSync } from "node:fs";
import { join } from "node:path";
import { clearCurrentRun, currentRun, isUnder, realPath, removePath, tryReadJsonField } from "../../verify-runtime/src/fs.ts";
import { killTree, readPidFile, waitDead } from "../../verify-runtime/src/process.ts";
import { removeScaffold } from "../../verify-runtime/src/scaffold.ts";
import { CURRENT_LINK, ROOT, SAMPLE_MARKER, SAMPLE_NAME, SKILL_DIR } from "./config.ts";

export async function cleanup(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK) ?? (args[0] === undefined ? undefined : realPath(args[0]));
  if (runDir === undefined) {
    console.log("verify-pie: no current run to clean up");
    return;
  }

  const serverPid = readPidFile(join(runDir, "pids/server.pid"));
  const vitePid = readPidFile(join(runDir, "pids/vite.pid"));
  console.log(`verify-pie: stopping server pid=${serverPid ?? "none"} vite pid=${vitePid ?? "none"}`);
  killTree(vitePid);
  killTree(serverPid);
  await waitDead(vitePid);
  await waitDead(serverPid);

  const meta = join(runDir, "meta.json");
  if (existsSync(meta)) {
    removeScaffold(tryReadJsonField<string>(meta, "sampleProject"), SAMPLE_MARKER, "verify-pie");
  }
  removeScaffold(join(process.env.HOME ?? "", SAMPLE_NAME), SAMPLE_MARKER, "verify-pie");

  if (isUnder(join(ROOT, "runs"), runDir)) {
    removePath(runDir);
    console.log(`verify-pie: removed ${runDir}`);
  }
  clearCurrentRun(CURRENT_LINK, runDir);
  console.log(`verify-pie: cleanup done (evidence kept under ${SKILL_DIR}/evidence/)`);
}
