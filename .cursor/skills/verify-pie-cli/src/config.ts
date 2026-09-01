import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "verify-pie-cli";
export const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = process.env.VERIFY_PIE_CLI_ROOT ?? "/tmp/verify-pie-cli";
export const CURRENT_LINK = join(ROOT, "current");
export const DEFAULT_PIE_PORT = 4182;
export const BIN = join(SKILL_DIR, "bin/verify-pie-cli");

export function refuseReservedPort(port: number): void {
  switch (port) {
    case 4000:
      throw new Error("refuse PIE_PORT=4000 — that is the user/desktop daemon port.");
    case 4180:
    case 4190:
      throw new Error(`refuse PIE_PORT=${port} — reserved for web verify-pie (serve 4180 / Vite 4190).`);
    default:
      return;
  }
}
