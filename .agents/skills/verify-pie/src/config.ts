import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "verify-pie";
export const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = process.env.VERIFY_PIE_ROOT ?? "/tmp/verify-pie";
export const CURRENT_LINK = join(ROOT, "current");
export const DEFAULT_PIE_PORT = 4180;
export const VITE_PORT = 4190;
export const SAMPLE_NAME = "verify-pie-sample";
export const SAMPLE_MARKER = ".verify-pie-scaffold";
export const BIN = join(SKILL_DIR, "bin/verify-pie");
