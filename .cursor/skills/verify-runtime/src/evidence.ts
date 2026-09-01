import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { copyDirContents, ensureDir, isoNow, readText, writeText } from "./fs.ts";
import { commandOnPath, runCommand } from "./process.ts";

export function evidenceDir(skillDir: string, runId: string): string {
  return join(skillDir, "evidence", runId);
}

export function stampEvidence(dest: string, runDir: string, doctorText: string): void {
  ensureDir(join(dest, "logs"));
  writeText(join(dest, "meta.json"), readText(join(runDir, "meta.json")));
  writeText(join(dest, "doctor.txt"), doctorText.endsWith("\n") ? doctorText : `${doctorText}\n`);
  writeText(join(dest, "created-at"), `${isoNow()}\n`);
  copyDirContents(join(runDir, "logs"), join(dest, "logs"));
}

export function appendNote(dest: string, text: string): void {
  ensureDir(dest);
  const path = join(dest, "notes.txt");
  const previous = existsSync(path) ? readText(path) : "";
  writeText(path, `${previous}${text}\n`);
}

export function agentBrowser(args: string[], outputPath?: string): string {
  if (commandOnPath("agent-browser") === undefined) {
    throw new Error("agent-browser is not on PATH");
  }
  const result = runCommand("agent-browser", args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `agent-browser ${args.join(" ")} failed`);
  }
  if (outputPath !== undefined) {
    writeText(outputPath, result.stdout);
  }
  return result.stdout;
}

export function copySideEffects(pieHome: string, dest: string, copySessionBodies: boolean): void {
  ensureDir(dest);
  const projects = join(pieHome, "storage/projects.json");
  if (existsSync(projects)) {
    writeText(join(dest, "projects.json"), readText(projects));
  } else {
    writeText(join(dest, "projects.json.missing"), "missing\n");
  }

  const sessionsDir = join(pieHome, "storage/sessions");
  if (!existsSync(sessionsDir)) {
    writeText(join(dest, "session-files.txt"), "no sessions dir\n");
    return;
  }

  const files = listJsonFiles(sessionsDir);
  writeText(join(dest, "session-files.txt"), files.length === 0 ? "" : `${files.join("\n")}\n`);
  if (!copySessionBodies) {
    return;
  }
  for (const file of files) {
    const rel = relative(sessionsDir, file);
    writeText(join(dest, "sessions", rel), readText(file));
  }
}

function listJsonFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        walk(path);
        continue;
      }
      if (name.name.endsWith(".json")) {
        out.push(path);
      }
    }
  };
  walk(root);
  return out.toSorted();
}
