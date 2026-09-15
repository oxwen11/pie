import fs from "node:fs";
import path from "node:path";

import { copyDirContents, ensureDir, isoNow, readText, removePath, writeText } from "./fs.ts";
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

const IDLE_VIDEO_FILTER = "mpdecimate=max=7,setpts=N/FRAME_RATE/TB";

export function packEvidenceVideo(input: string, dest: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) || /^recording-\d+$/.test(name)) {
    throw new Error(`invalid packed video name: ${name}`);
  }
  if (!fs.existsSync(input) || fs.statSync(input).size === 0) {
    throw new Error(`no completed recording at ${input}`);
  }
  const ffmpeg = commandOnPath("ffmpeg");
  if (ffmpeg === undefined) throw new Error("ffmpeg is required to pack evidence video");

  const output = path.join(dest, `${name}.webm`);
  const temporary = path.join(dest, `.${name}.${process.pid}.webm`);
  const result = runCommand(ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    IDLE_VIDEO_FILTER,
    "-an",
    "-c:v",
    "libvpx",
    "-crf",
    "30",
    "-b:v",
    "2000k",
    "-pix_fmt",
    "yuv420p",
    temporary,
  ]);
  if (result.status !== 0) {
    removePath(temporary);
    throw new Error(result.stderr.trim() || `ffmpeg exited ${result.status}`);
  }
  fs.renameSync(temporary, output);
  return output;
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
