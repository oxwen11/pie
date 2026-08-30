import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveDaemonCompatibilityKey } from "@getpie/core/build-id";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(desktopDirectory, "../..");
const releaseDirectory = path.join(desktopDirectory, "release");
const executable = findPackagedExecutable(releaseDirectory);
if (executable === undefined) {
  throw new Error(`No packaged Pie executable found under ${releaseDirectory}`);
}

const result = childProcess.spawnSync(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "-c",
    "e2e/playwright.config.ts",
    "e2e/tests/daemon-compatibility.spec.ts",
  ],
  {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      PIE_E2E_EXECUTABLE: executable,
      PIE_E2E_EXPECTED_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey({ cwd: repositoryRoot }),
    },
    stdio: "inherit",
  },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;

function findPackagedExecutable(directory) {
  if (!fs.existsSync(directory)) return undefined;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findPackagedExecutable(candidate);
      if (nested !== undefined) return nested;
      continue;
    }
    const normalized = candidate.split(path.sep).join("/");
    if (
      normalized.endsWith("/Pie.app/Contents/MacOS/Pie") ||
      normalized.endsWith("/Pie.exe") ||
      (process.platform === "linux" && entry.name === "pie")
    ) {
      return candidate;
    }
  }
  return undefined;
}
