import fs from "node:fs";
import path from "node:path";

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  test as base,
} from "@playwright/test";

/** The one seeded project's id — the contract validates projectId as a UUID. */
export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Seed one project into a per-test `$PIE_HOME`: a fresh home renders the
 * first-project onboarding instead of the composer, so chat flows need a
 * project up front.
 */
export function seedProject(pieHome: string, workspace: string): void {
  fs.mkdirSync(workspace, { recursive: true });
  const storage = path.join(pieHome, "storage");
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(
    path.join(storage, "projects.json"),
    JSON.stringify({
      version: 1,
      data: [
        {
          id: PROJECT_ID,
          name: "e2e-workspace",
          path: workspace,
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
    }),
  );
}

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
    daemonDir: string;
    fakePiLog: string;
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
    await use({
      daemonDir: path.join(pieHome, "daemon"),
      fakePiLog: path.join(output, "fake-pi.jsonl"),
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
        PIE_E2E_PI_DELAY_MS: "1000",
        PIE_HOME: e2ePaths.pieHome,
        PIE_DAEMON_DIR: e2ePaths.daemonDir,
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
