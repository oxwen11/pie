import fs from "node:fs";
import path from "node:path";

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  test as base,
} from "@playwright/test";

import {
  e2eIsolatedAgentEnv,
  e2ePiProcessEnv,
} from "../../../../tools/testing/seed-e2e-pi-agent.mts";

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
  let record: { pid?: number };
  try {
    record = JSON.parse(
      await fs.promises.readFile(path.join(pieHome, "daemon", "daemon.pid"), "utf8"),
    ) as { pid?: number };
  } catch {
    // No daemon record (never spawned).
    return;
  }
  if (typeof record.pid === "number" && record.pid > 0) {
    await stopProcess(record.pid);
  }
}

export async function stopProcess(pid: number, graceMs = 5_000): Promise<void> {
  if (!processAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processAlive(pid)) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  if (!processAlive(pid)) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline && processAlive(pid)) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  if (processAlive(pid)) throw new Error(`Process ${pid} did not exit after SIGKILL`);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type E2ePaths = {
  userData: string;
  pieHome: string;
  /** Env overlay for Electron. Default: isolated empty agent dir only. */
  launchEnv: Record<string, string>;
};

function makePaths(
  testInfo: { outputPath: () => string },
  launchEnv: (pieHome: string) => Record<string, string>,
): E2ePaths {
  const output = testInfo.outputPath();
  fs.mkdirSync(output, { recursive: true });
  const pieHome = path.join(output, "pie-home");
  fs.mkdirSync(pieHome, { recursive: true });
  seedProject(pieHome, path.join(output, "workspace"));
  return {
    userData: path.join(output, "user-data"),
    pieHome,
    launchEnv: launchEnv(pieHome),
  };
}

/**
 * Env for any Electron launch in desktop e2e: test mode, isolated home,
 * empty agent dir (seeded over by chat specs' `launchEnv`).
 */
export function pieElectronEnv(pieHome: string, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    PIE_E2E: "1",
    PIE_HOME: pieHome,
    ...e2eIsolatedAgentEnv(pieHome),
    ...extra,
  };
}

async function launchApp(e2ePaths: E2ePaths): Promise<ElectronApplication> {
  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
  return electron.launch({
    args: [appPath, `--user-data-dir=${e2ePaths.userData}`],
    env: pieElectronEnv(e2ePaths.pieHome, e2ePaths.launchEnv),
  });
}

/**
 * Default desktop e2e: window / daemon / MessagePort. No fake provider —
 * pie-pi-process is not part of these proofs.
 */
export const test = base.extend<{
  e2ePaths: E2ePaths;
  electronApp: ElectronApplication;
  window: Page;
}>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  e2ePaths: async ({}, use, testInfo) => {
    const paths = makePaths(testInfo, e2eIsolatedAgentEnv);
    await use(paths);
    await stopDaemonFor(paths.pieHome);
  },

  electronApp: async ({ e2ePaths }, use) => {
    const app = await launchApp(e2ePaths);
    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 30_000 });
    await use(window);
  },
});

/** Reply the e2e provider returns in desktop chat specs. */
const CHAT_REPLY = "Desktop fake Pi reply";

/**
 * Conversation e2e only: seeds the e2e provider so a real pie-pi-process can
 * answer without an API key.
 */
export const chatTest = test.extend<{
  e2ePaths: E2ePaths;
  fakeReply: string;
}>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  e2ePaths: async ({}, use, testInfo) => {
    const paths = makePaths(testInfo, (pieHome) => e2ePiProcessEnv(pieHome, { reply: CHAT_REPLY }));
    await use(paths);
    await stopDaemonFor(paths.pieHome);
  },

  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  fakeReply: async ({}, use) => {
    await use(CHAT_REPLY);
  },
});

export { expect } from "@playwright/test";
