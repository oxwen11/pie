import path from "node:path";

import { agentBrowser } from "../../runtime/browser.ts";
import { appendNote, copySideEffects, evidenceDir, stampEvidence } from "../../runtime/evidence.ts";
import { usage } from "../../runtime/fail.ts";
import { currentRun, readJsonField } from "../../runtime/fs.ts";
import { BROWSER_SESSION, CURRENT_LINK, SKILL_DIR } from "./config.ts";
import { doctorReport } from "./doctor.ts";

export async function evidence(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const runId = readJsonField<string>(path.join(runDir, "meta.json"), "runId");
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
      const destPath = path.join(dest, `${rest[0] ?? "screen"}.png`);
      agentBrowser(["screenshot", destPath], { session: BROWSER_SESSION });
      console.log(destPath);
      return;
    }
    case "snapshot": {
      const destPath = path.join(dest, `${rest[0] ?? "snapshot"}.txt`);
      agentBrowser(["snapshot"], { session: BROWSER_SESSION, outputPath: destPath });
      console.log(destPath);
      return;
    }
    case "url": {
      const text = agentBrowser(["get", "url"], {
        session: BROWSER_SESSION,
        outputPath: path.join(dest, "url.txt"),
      });
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      return;
    }
    case "side-effects": {
      const side = path.join(dest, "side-effects");
      copySideEffects(readJsonField<string>(path.join(runDir, "meta.json"), "pieHome"), side, true);
      console.log(side);
      return;
    }
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      usage(`Usage:
  pie-verify web evidence path
  pie-verify web evidence init
  pie-verify web evidence screenshot <name>
  pie-verify web evidence snapshot <name>
  pie-verify web evidence url
  pie-verify web evidence side-effects
  pie-verify web evidence note <text>`);
  }
}
