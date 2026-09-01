import path from "node:path";

import { readRunMeta } from "../meta.ts";
import { appendNote, evidenceDir, stampEvidence } from "../runtime/evidence.ts";
import { usage } from "../runtime/fail.ts";
import { currentRun } from "../runtime/fs.ts";
import type { SurfaceDefinition } from "../surface.ts";
import { doctorReport } from "./doctor.ts";

export async function evidence(surface: SurfaceDefinition, args: string[]): Promise<void> {
  const { identity } = surface;
  const runDir = currentRun(identity.currentLink);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const meta = readRunMeta(path.join(runDir, "meta.json"));
  const dest = evidenceDir(identity.skillDir, meta.runId);
  const command = args[0] ?? "path";
  const rest = args.slice(1);

  switch (command) {
    case "path":
      console.log(dest);
      return;
    case "init":
      stampEvidence(dest, runDir, await doctorReport(surface));
      surface.afterEvidenceInit?.(dest, runDir, meta);
      console.log(dest);
      return;
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      if (
        surface.evidenceExtra !== undefined &&
        (await surface.evidenceExtra(command, rest, dest, runDir, meta))
      ) {
        return;
      }
      usage(surface.evidenceUsage);
  }
}
