import fs from "node:fs";
import path from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import packageJson from "../package.json" with { type: "json" };
import { LoopError } from "./cron";

export const PROMPT_MAX_BYTES = 25_000;

export const BUILTIN_MAINTENANCE_PROMPT = [
  "Continue unfinished work in the current session.",
  "Check CI, review, merge conflicts, and tests for the current work.",
  "If there is nothing pending, do a limited bug hunt, simplification, or cleanup.",
  "Do not start a new project unrelated to this session.",
  "Do not expand permissions or available tools.",
  "If there is no useful work, call schedule_wakeup to delay or stop instead of inventing tasks.",
].join("\n");

export const LOOP_CUSTOM_TYPE = packageJson.name;

export interface LoopMessageDetails {
  taskId: string;
  kind: "recurring" | "one_shot" | "dynamic";
  prompt: string;
}

export function buildScheduledContent(prompt: string, dynamic: boolean): string {
  const wakeup = dynamic
    ? "When finished, call schedule_wakeup exactly once: delay_seconds between 60 and 3600, or stop=true."
    : "This is a fixed loop iteration. Do not call schedule_wakeup.";
  return ["Scheduled loop iteration. Run only this task:", "", prompt, "", wakeup].join("\n");
}

export function resolveMaintenancePrompt(options: {
  cwd: string;
  isProjectTrusted: () => boolean;
}): string {
  if (options.isProjectTrusted()) {
    const project = readLoopMd(path.join(options.cwd, CONFIG_DIR_NAME, "loop.md"));
    if (project) return project;
  }
  const user = readLoopMd(path.join(getAgentDir(), "loop.md"));
  return user ?? BUILTIN_MAINTENANCE_PROMPT;
}

export function assertPromptSize(prompt: string): void {
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_MAX_BYTES) {
    throw new LoopError("PROMPT_TOO_LARGE", "prompt exceeds 25,000 bytes");
  }
}

export function previewPrompt(prompt: string, max = 80): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, max);
}

function readLoopMd(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath);
    if (raw.byteLength > PROMPT_MAX_BYTES) {
      return raw.subarray(0, PROMPT_MAX_BYTES).toString("utf8");
    }
    const text = raw.toString("utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
