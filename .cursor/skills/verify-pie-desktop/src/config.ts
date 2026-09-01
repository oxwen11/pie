import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "verify-pie-desktop";
export const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = process.env.VERIFY_PIE_DESKTOP_ROOT ?? "/tmp/verify-pie-desktop";
export const CURRENT_LINK = join(ROOT, "current");
export const DEFAULT_DAEMON_PORT = 4000;
export const DEFAULT_CDP_PORT = 9223;
export const SAMPLE_NAME = "verify-pie-desktop-sample";
export const SAMPLE_MARKER = ".verify-pie-desktop-scaffold";
export const BIN = join(SKILL_DIR, "bin/verify-pie-desktop");

export function userDataDir(cdpPort: number): string {
  return join(process.env.TMPDIR ?? "/tmp", `pie-desktop-remote-debugging-${cdpPort}`);
}

export function refuseWebOrCliPort(port: number): void {
  switch (port) {
    case 4180:
    case 4190:
      throw new Error(`refuse using ${port} — reserved for web verify-pie.`);
    case 4182:
      throw new Error("refuse using 4182 — reserved for verify-pie-cli.");
    default:
      return;
  }
}
