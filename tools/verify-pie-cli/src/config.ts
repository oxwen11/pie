import path from "node:path";

import { findRepoRoot } from "./runtime/process.ts";

export const SKILL = "verify-pie-cli";
export const SKILL_DIR =
  process.env.VERIFY_PIE_CLI_SKILL_DIR ??
  path.join(findRepoRoot(), ".agents/skills/verify-pie-cli");
export const ROOT = process.env.VERIFY_PIE_CLI_ROOT ?? "/tmp/verify-pie-cli";
export const CURRENT_LINK = path.join(ROOT, "current");
export const DEFAULT_PIE_PORT = 4182;
export const BIN = process.env.VERIFY_PIE_CLI_BIN ?? "verify-pie-cli";

export function refuseReservedPort(port: number): void {
  switch (port) {
    case 4000:
      throw new Error("refuse PIE_PORT=4000 — that is the user/desktop daemon port.");
    case 4180:
    case 4190:
      throw new Error(
        `refuse PIE_PORT=${port} — reserved for web verify-pie (serve 4180 / Vite 4190).`,
      );
    default:
      break;
  }
}
