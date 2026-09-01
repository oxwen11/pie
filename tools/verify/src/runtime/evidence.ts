import fs from "node:fs";
import path from "node:path";

import { copyDirContents, ensureDir, isoNow, readText, writeText } from "./fs.ts";

export function evidenceDir(skillDir: string, runId: string): string {
  return path.join(skillDir, "evidence", runId);
}

export function stampEvidence(dest: string, runDir: string, doctorText: string): void {
  ensureDir(path.join(dest, "logs"));
  writeText(path.join(dest, "meta.json"), readText(path.join(runDir, "meta.json")));
  writeText(
    path.join(dest, "doctor.txt"),
    doctorText.endsWith("\n") ? doctorText : `${doctorText}\n`,
  );
  writeText(path.join(dest, "created-at"), `${isoNow()}\n`);
  copyDirContents(path.join(runDir, "logs"), path.join(dest, "logs"));
}

export function appendNote(dest: string, text: string): void {
  ensureDir(dest);
  const notePath = path.join(dest, "notes.txt");
  const previous = fs.existsSync(notePath) ? readText(notePath) : "";
  writeText(notePath, `${previous}${text}\n`);
}

export function copySideEffects(pieHome: string, dest: string, copySessionBodies: boolean): void {
  ensureDir(dest);
  const projects = path.join(pieHome, "storage/projects.json");
  if (fs.existsSync(projects)) {
    writeText(path.join(dest, "projects.json"), readText(projects));
  } else {
    writeText(path.join(dest, "projects.json.missing"), "missing\n");
  }

  const sessionsDir = path.join(pieHome, "storage/sessions");
  if (!fs.existsSync(sessionsDir)) {
    writeText(path.join(dest, "session-files.txt"), "no sessions dir\n");
    return;
  }

  const files = listJsonFiles(sessionsDir);
  writeText(
    path.join(dest, "session-files.txt"),
    files.length === 0 ? "" : `${files.join("\n")}\n`,
  );
  if (!copySessionBodies) {
    return;
  }
  for (const file of files) {
    const rel = path.relative(sessionsDir, file);
    writeText(path.join(dest, "sessions", rel), readText(file));
  }
}

function listJsonFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, name.name);
      if (name.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (name.name.endsWith(".json")) {
        out.push(filePath);
      }
    }
  };
  walk(root);
  return out.toSorted();
}
