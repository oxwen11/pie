import fs from "node:fs";
import path from "node:path";

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  test as base,
} from "@playwright/test";

import { PROJECT_ID, seedProject } from "../../../../tools/testing/e2e-web.js";

export { PROJECT_ID, seedProject };

/**
 * Stop the daemon recorded under this home. The app attaches to (or spawns)
 * the shared pie daemon, which deliberately outlives Electron; with a
 * per-test `$PIE_HOME` that means a per-test daemon — stop it in teardown
 * or every test leaks one.
 */
export async function stopDaemonFor(pieHome: string): Promise<void> {
  try {
    const record = JSON.parse(
      await fs.promises.readFile(path.join(pieHome, "daemon", "daemon.pid"), "utf8"),
    ) as { pid?: number };
    if (typeof record.pid === "number" && record.pid > 0) {
      process.kill(record.pid, "SIGTERM");
    }
  } catch {
    // No daemon record (never spawned) or the process is already gone.
  }
}

/**
 * Extended test fixtures for Electron testing
 */
export const test = base.extend<{
  e2ePaths: {
    fakePiLog: string;
    /** Stale name still read by desktop-rpc.spec.ts — same file as fakePiLog. */
    fakeClaudeLog: string;
    userData: string;
    pieHome: string;
  };
  electronApp: ElectronApplication;
  window: Page;
}>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  e2ePaths: async ({}, use, testInfo) => {
    const output = testInfo.outputPath();
    fs.mkdirSync(output, { recursive: true });
    const pieHome = path.join(output, "pie-home");
    fs.mkdirSync(pieHome, { recursive: true });
    seedProject(pieHome, path.join(output, "workspace"));
    const fakePiLog = path.join(output, "fake-pi.jsonl");
    await use({
      fakePiLog,
      fakeClaudeLog: fakePiLog,
      userData: path.join(output, "user-data"),
      pieHome,
    });

    await stopDaemonFor(pieHome);
  },

  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  electronApp: async ({ e2ePaths }, use) => {
    const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
    const fakePiPath = path.join(import.meta.dirname, "../../../../tools/testing/fake-pi.mjs");

    const app = await electron.launch({
      args: [appPath, `--user-data-dir=${e2ePaths.userData}`],
      env: {
        ...process.env,
        NODE_ENV: "test",
        PIE_E2E: "1",
        PIE_E2E_PI_EXECUTABLE: fakePiPath,
        PIE_E2E_PI_LOG: e2ePaths.fakePiLog,
        PIE_E2E_PI_RESPONSE: "Desktop fake Pi reply",
        PIE_HOME: e2ePaths.pieHome,
      },
    });

    await use(app);

    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 30_000 });
    await use(window);
  },
});

export { expect } from "@playwright/test";
