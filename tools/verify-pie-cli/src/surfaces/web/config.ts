import path from "node:path";

import { findRepoRoot } from "../../runtime/process.ts";

export const SKILL = "verify-pie";
export const SKILL_DIR =
  process.env.VERIFY_PIE_SKILL_DIR ?? path.join(findRepoRoot(), ".agents/skills/verify-pie");
export const ROOT = process.env.VERIFY_PIE_ROOT ?? "/tmp/verify-pie";
export const CURRENT_LINK = path.join(ROOT, "current");
export const DEFAULT_PIE_PORT = 4180;
export const VITE_PORT = 4190;
export const SAMPLE_NAME = "verify-pie-sample";
export const SAMPLE_MARKER = ".verify-pie-scaffold";
export const BIN = process.env.VERIFY_PIE_BIN ?? "pie-verify web";
