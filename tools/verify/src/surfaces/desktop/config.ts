import path from "node:path";

import { findRepoRoot } from "../../runtime/process.ts";

export const SKILL = "verify-pie-desktop";
export const SKILL_DIR =
  process.env.VERIFY_PIE_DESKTOP_SKILL_DIR ??
  path.join(findRepoRoot(), ".agents/skills/verify-pie-desktop");
export const ROOT = process.env.VERIFY_PIE_DESKTOP_ROOT ?? "/tmp/verify-pie-desktop";
export const CURRENT_LINK = path.join(ROOT, "current");
export const DEFAULT_DAEMON_PORT = 4000;
export const DEFAULT_CDP_PORT = 9223;
export const SAMPLE_NAME = "verify-pie-desktop-sample";
export const SAMPLE_MARKER = ".verify-pie-desktop-scaffold";
export const BIN = process.env.VERIFY_PIE_DESKTOP_BIN ?? "pie-verify desktop";
export const BROWSER_SESSION =
  process.env.VERIFY_PIE_DESKTOP_BROWSER_SESSION ?? "verify-pie-desktop";

export function userDataDir(cdpPort: number): string {
  return path.join(process.env.TMPDIR ?? "/tmp", `pie-desktop-remote-debugging-${cdpPort}`);
}

export function refuseWebOrCliPort(port: number): void {
  switch (port) {
    case 4180:
    case 4190:
      throw new Error(`refuse using ${port} — reserved for web verify-pie.`);
    case 4182:
      throw new Error("refuse using 4182 — reserved for verify-pie-cli.");
    default:
      break;
  }
}
