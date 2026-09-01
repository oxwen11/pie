import fs from "node:fs";
import path from "node:path";

import { copyDirContents, ensureDir, isoNow, readText, writeText } from "./fs.ts";
import { commandOnPath, runCommand } from "./process.ts";

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

export type AgentBrowserOptions = {
  outputPath?: string;
  session?: string;
  cdpPort?: number;
};

export function agentBrowser(args: string[], options: AgentBrowserOptions = {}): string {
  if (commandOnPath("agent-browser") === undefined) {
    throw new Error(
      "agent-browser is not on PATH — desktop drive uses `agent-browser connect`, not raw CDP curl",
    );
  }
  const argv: string[] = [];
  if (options.session !== undefined) {
    argv.push("--session", options.session);
  }
  if (options.cdpPort !== undefined) {
    argv.push("--cdp", String(options.cdpPort));
  }
  argv.push(...args);
  const result = runCommand("agent-browser", argv);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `agent-browser ${argv.join(" ")} failed`);
  }
  if (options.outputPath !== undefined) {
    writeText(options.outputPath, result.stdout);
  }
  return result.stdout;
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
