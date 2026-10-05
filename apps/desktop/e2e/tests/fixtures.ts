import fs from "node:fs";
import path from "node:path";

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test as base,
} from "@playwright/test";

import {
  e2eIsolatedAgentEnv,
  e2ePiProcessEnv,
} from "../../../../tools/testing/seed-e2e-pi-agent.mts";

/** Switches that keep Electron 44 from wedging before "DevTools listening" on Xvfb. */
const LINUX_CI_SWITCHES = [
  "--ozone-platform=x11",
  "--disable-gpu",
  "--in-process-gpu",
  "--no-sandbox",
  "--no-zygote",
  "--disable-dev-shm-usage",
];

const FAKE_PI_PATH = path.join(import.meta.dirname, "../../../../tools/testing/fake-pi.mjs");

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
  workspace: string;
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
  const workspace = path.join(output, "workspace");
  fs.mkdirSync(pieHome, { recursive: true });
  seedProject(pieHome, workspace);
  return {
    userData: path.join(output, "user-data"),
    pieHome,
    workspace,
    launchEnv: launchEnv(pieHome),
  };
}

/**
 * Env for any Electron launch in desktop e2e: test mode, isolated home,
 * empty agent dir (seeded over by chat specs' `launchEnv`).
 */
export function fakePiEnv(pieHome: string) {
  return {
    ...e2eIsolatedAgentEnv(pieHome),
    PIE_E2E_PI_EXECUTABLE: FAKE_PI_PATH,
    PIE_E2E_PI_LOG: path.join(pieHome, "fake-pi.jsonl"),
    PIE_E2E_PI_RESPONSE: "Desktop fake Pi reply",
  };
}

export function pieElectronEnv(pieHome: string, extra: Record<string, string> = {}) {
  const nodeExec = process.env.npm_node_execpath ?? process.execPath;
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...launchEnv } = process.env;
  const linuxCi = process.platform === "linux" && process.env.CI;
  // Leave a breadcrumb for splash-timeout dumps.
  fs.mkdirSync(pieHome, { recursive: true });
  fs.writeFileSync(path.join(pieHome, "e2e-node.txt"), nodeExec);
  return {
    ...launchEnv,
    NODE_ENV: "test",
    PIE_E2E: "1",
    PIE_HOME: pieHome,
    // Tests use Node for the detached daemon; Electron-as-Node can hang pre-health.
    PIE_E2E_NODE: nodeExec,
    npm_node_execpath: nodeExec,
    ...e2eIsolatedAgentEnv(pieHome),
    ...extra,
    ...(linuxCi
      ? {
          // Leave DISPLAY for xvfb-run. Wayland would hide the window from X.
          WAYLAND_DISPLAY: undefined,
          ELECTRON_OZONE_PLATFORM_HINT: "x11",
          // Read before argv, so a setuid sandbox helper cannot stall launch.
          ELECTRON_DISABLE_SANDBOX: "1",
          DBUS_SESSION_BUS_ADDRESS: "disabled:",
        }
      : undefined),
  };
}

/** Linux runner switches; the Xvfb-specific set stays CI-only. */
export function linuxElectronArgs(): string[] {
  if (process.platform !== "linux") return [];
  return process.env.CI ? LINUX_CI_SWITCHES : ["--no-sandbox", "--disable-dev-shm-usage"];
}

/** Chromium switches that have to precede the app entry. */
export function electronAppArgs(appPath: string, userData: string): string[] {
  return [...linuxElectronArgs(), appPath, `--user-data-dir=${userData}`];
}

export function launchPieElectron(
  appPath: string,
  userData: string,
  pieHome: string,
  extra: Record<string, string> = {},
) {
  return electron.launch({
    args: electronAppArgs(appPath, userData),
    env: pieElectronEnv(pieHome, extra),
    ...(process.platform === "linux" && process.env.CI ? { timeout: 30_000 } : undefined),
  });
}

/** Dump daemon files so a stuck splash fails with a cause, not a blank timeout. */
export function dumpPieHomeDiagnostics(pieHome: string): string {
  const files = [
    path.join(pieHome, "e2e-node.txt"),
    path.join(pieHome, "daemon", "daemon.pid"),
    path.join(pieHome, "logs", "daemon-stdio.log"),
    path.join(pieHome, "logs", "pie.log"),
  ];
  const chunks: string[] = [`pieHome=${pieHome}`];
  for (const file of files) {
    try {
      chunks.push(`--- ${file} ---\n${fs.readFileSync(file, "utf8").slice(-8000)}`);
    } catch (error) {
      chunks.push(`--- ${file} ---\n${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return chunks.join("\n");
}

export async function awaitDesktopReady(window: Page, pieHome: string, timeout = 30_000) {
  try {
    // The splash may not be mounted when firstWindow resolves, so waiting for
    // it to be hidden can pass before startup begins. The app root only becomes
    // visible after the renderer has its MessagePort.
    await expect(window.locator("#root")).toBeVisible({ timeout });
  } catch (error) {
    const body = await window
      .locator("body")
      .textContent()
      .catch(() => "<no body>");
    const root = await window
      .locator("#root")
      .innerHTML()
      .catch(() => "<no root>");
    const details = `${error instanceof Error ? error.message : String(error)}\nURL: ${window.url()}\nUI:\n${body}\nROOT:\n${root}\n${dumpPieHomeDiagnostics(pieHome)}`;
    // Test timeout can swallow the thrown Error; always print first.
    console.error(details);
    throw new Error(details, { cause: error });
  }
}

/**
 * Runtime disposal can wedge Electron shutdown, especially on Linux. Bound
 * graceful close, then kill the isolated e2e process so later tests can start.
 * ponytail: SIGKILL fallback. Drop when runtime disposal is reliably bounded.
 */
export async function closeElectron(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  let pid: number | undefined;
  try {
    pid = app.process().pid;
  } catch {
    // Already closed (Quit button / prior close).
    return;
  }

  const closed = app.close().then(
    () => undefined,
    () => undefined,
  );
  const outcome = await Promise.race([
    closed.then(() => "closed" as const),
    new Promise<"hung">((resolve) => {
      setTimeout(() => resolve("hung"), process.platform === "linux" ? 1_000 : 5_000);
    }),
  ]);
  if (outcome === "closed") return;

  if (typeof pid === "number" && processAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  await Promise.race([
    closed,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000);
    }),
  ]);
}

async function launchApp(e2ePaths: E2ePaths): Promise<ElectronApplication> {
  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
  return launchPieElectron(appPath, e2ePaths.userData, e2ePaths.pieHome, e2ePaths.launchEnv);
}

/**
 * Default desktop e2e: window / daemon / MessagePort. Main's startup queries
 * need Pi discovery, so use the process-level fake without a model turn.
 */
export const test = base.extend<{
  e2ePaths: E2ePaths;
  electronApp: ElectronApplication;
  window: Page;
}>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  e2ePaths: async ({}, use, testInfo) => {
    const paths = makePaths(testInfo, fakePiEnv);
    await use(paths);
    await stopDaemonFor(paths.pieHome);
  },

  electronApp: async ({ e2ePaths }, use) => {
    const app = await launchApp(e2ePaths);
    await use(app);
    await closeElectron(app);
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
  fakeReply: [CHAT_REPLY, { option: true }],

  e2ePaths: async ({ fakeReply }, use, testInfo) => {
    const paths = makePaths(testInfo, (pieHome) => e2ePiProcessEnv(pieHome, { reply: fakeReply }));
    await use(paths);
    await stopDaemonFor(paths.pieHome);
  },
});

export { expect } from "@playwright/test";
