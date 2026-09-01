import { join } from "node:path";
import { agentBrowser, appendNote, copySideEffects, evidenceDir, stampEvidence } from "../../verify-runtime/src/evidence.ts";
import { usage } from "../../verify-runtime/src/fail.ts";
import { currentRun, readJsonField } from "../../verify-runtime/src/fs.ts";
import { CURRENT_LINK, SKILL_DIR } from "./config.ts";
import { doctorReport } from "./doctor.ts";

export async function evidence(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const runId = readJsonField<string>(join(runDir, "meta.json"), "runId");
  const dest = evidenceDir(SKILL_DIR, runId);
  const command = args[0] ?? "path";
  const rest = args.slice(1);

  switch (command) {
    case "path":
      console.log(dest);
      return;
    case "init":
      stampEvidence(dest, runDir, await doctorReport());
      console.log(dest);
      return;
    case "screenshot": {
      const path = join(dest, `${rest[0] ?? "screen"}.png`);
      agentBrowser(["screenshot", path]);
      console.log(path);
      return;
    }
    case "snapshot": {
      const path = join(dest, `${rest[0] ?? "snapshot"}.txt`);
      agentBrowser(["snapshot"], { outputPath: path });
      console.log(path);
      return;
    }
    case "url": {
      const text = agentBrowser(["get", "url"], { outputPath: join(dest, "url.txt") });
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      return;
    }
    case "side-effects": {
      const side = join(dest, "side-effects");
      copySideEffects(readJsonField<string>(join(runDir, "meta.json"), "pieHome"), side, true);
      console.log(side);
      return;
    }
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      usage(`Usage:
  verify-pie evidence path
  verify-pie evidence init
  verify-pie evidence screenshot <name>
  verify-pie evidence snapshot <name>
  verify-pie evidence url
  verify-pie evidence side-effects
  verify-pie evidence note <text>`);
  }
}
