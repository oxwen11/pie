import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

import { expect, stopDaemonFor, test } from "./fixtures.js";

function appPid(electronApp: ElectronApplication): number {
  const pid = electronApp.process().pid;
  if (pid === undefined) throw new Error("Electron process has no pid");
  return pid;
}

function findServerPid(pieHome: string): number | undefined {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(pieHome, "daemon", "daemon.pid"), "utf8"),
    ) as { pid?: number };
    return typeof record.pid === "number" && processExists(record.pid) ? record.pid : undefined;
  } catch {
    return undefined;
  }
}

function serverPid(pieHome: string): number {
  const pid = findServerPid(pieHome);
  if (pid === undefined) throw new Error("Resident daemon was not found");
  return pid;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function frontmostApplicationPid(): number | undefined {
  if (process.platform !== "darwin") return undefined;
  const application = childProcess
    .execFileSync("/usr/bin/lsappinfo", ["front"], { encoding: "utf8" })
    .trim();
  const info = childProcess.execFileSync(
    "/usr/bin/lsappinfo",
    ["info", "-only", "pid", application],
    {
      encoding: "utf8",
    },
  );
  const match = info.match(/"pid"=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

async function waitForServer(pieHome: string): Promise<number> {
  await expect.poll(() => findServerPid(pieHome), { timeout: 30_000 }).toBeTruthy();
  return serverPid(pieHome);
}

/**
 * The server child appears well before it reports ready, and a first spawn
 * killed pre-ready is a boot failure by design (terminal state, no respawn).
 * These kill tests mean "kill a running server", so wait until the renderer
 * left the splash — that requires the ready handshake to have completed.
 */
async function waitForConnectedUi(window: Page): Promise<void> {
  // The splash carries "Starting Pie" as an aria-label, not text content,
  // and unmounts permanently once the renderer connects.
  await expect(window.getByRole("main", { name: "Starting Pie" })).toBeHidden({
    timeout: 30_000,
  });
}

async function driveServerToFailed(window: Page, pieHome: string): Promise<void> {
  await waitForConnectedUi(window);
  const terminalFailure = window.getByText("The local server stopped");
  let currentPid = await waitForServer(pieHome);
  for (let failure = 0; failure < 6; failure += 1) {
    process.kill(currentPid, "SIGKILL");
    let outcome: number | "failed" = currentPid;
    await expect
      .poll(
        async () => {
          outcome = (await terminalFailure.isVisible())
            ? "failed"
            : (findServerPid(pieHome) ?? currentPid);
          return outcome;
        },
        { timeout: 30_000 },
      )
      .not.toBe(currentPid);
    if (outcome === "failed") return;
    currentPid = outcome;
  }
}

test("renders in the background without taking focus and connects to the server", async ({
  electronApp,
  window,
}) => {
  await expect(window).toHaveTitle("Pie");
  await expect(window.locator("#root")).toBeVisible();
  await expect(window.getByText("Pie could not start")).toHaveCount(0);
  await expect(
    electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      return { visible: browserWindow?.isVisible(), focused: browserWindow?.isFocused() };
    }),
  ).resolves.toEqual({ visible: false, focused: false });
  const renderSize = await window.locator("#root").evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(renderSize.width).toBeGreaterThan(0);
  expect(renderSize.height).toBeGreaterThan(0);
  expect(frontmostApplicationPid()).not.toBe(appPid(electronApp));
  await expect(
    window.evaluate(() => {
      // Runs in the renderer, where `window` is the DOM window, not the Page.
      const globals = window as Window & {
        pie?: unknown;
        require?: unknown;
        process?: unknown;
      };
      return {
        pie: typeof globals.pie,
        require: typeof globals.require,
        process: typeof globals.process,
      };
    }),
  ).resolves.toEqual({ pie: "undefined", require: "undefined", process: "undefined" });
});

test("gives a reloaded renderer document a new MessagePort", async ({ e2ePaths, window }) => {
  const pid = await waitForServer(e2ePaths.pieHome);

  await window.reload();
  await expect(window).toHaveTitle("Pie");
  await expect(window.locator("#root")).toBeVisible();
  await expect(window.getByText("Pie could not start")).toHaveCount(0);
  expect(serverPid(e2ePaths.pieHome)).toBe(pid);
});

// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test("boots the development HTTP renderer through MessagePort", async ({}, testInfo) => {
  const rendererRoot = path.join(import.meta.dirname, "../../dist/renderer");
  const server = http.createServer((request, response) => {
    const requested = path.join(
      rendererRoot,
      new URL(request.url ?? "/", "http://localhost").pathname,
    );
    const target =
      fs.existsSync(requested) && fs.statSync(requested).isFile()
        ? requested
        : path.join(rendererRoot, "index.html");
    response.setHeader(
      "Content-Type",
      target.endsWith(".js")
        ? "text/javascript"
        : target.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    fs.createReadStream(target).pipe(response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Development server did not bind");
  const origin = `http://127.0.0.1:${address.port}`;

  // Own userData so its single-instance lock can't collide with a real `dev`.
  const userData = path.join(testInfo.outputPath(), "user-data");
  fs.mkdirSync(userData, { recursive: true });
  // Own server storage so the developer's real ~/.pie never leaks in.
  const pieHome = path.join(testInfo.outputPath(), "pie-home");
  fs.mkdirSync(pieHome, { recursive: true });

  const app = await electron.launch({
    args: [
      path.join(import.meta.dirname, "../../dist/main/index.js"),
      `--user-data-dir=${userData}`,
    ],
    env: {
      ...process.env,
      NODE_ENV: "development",
      ELECTRON_RENDERER_URL: origin,
      PIE_E2E: "1",
      PIE_HOME: pieHome,
      PIE_DAEMON_DIR: path.join(pieHome, "daemon"),
    },
  });

  try {
    const window = await app.firstWindow({ timeout: 30_000 });
    await expect(window).toHaveTitle("Pie");
    await expect(window.getByText("Pie could not start")).toHaveCount(0);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    // This test builds its own $PIE_HOME instead of using the fixture, so
    // it also owns stopping the per-test daemon.
    await stopDaemonFor(pieHome);
  }
});

test("chats through Pi and the fake Pi executable", async ({ e2ePaths, window }) => {
  // The app lands on /draft, the new-session surface: picking the seeded
  // project and typing the first message creates the session and navigates
  // into it. There is no default project — the composer blocks until one is
  // chosen.
  await waitForConnectedUi(window);

  await window.getByRole("combobox").filter({ hasText: "Select a project" }).click();
  await window.getByRole("option", { name: /e2e-workspace/ }).click();

  const input = window.locator("[contenteditable='true']");
  await input.fill("Desktop SDK E2E");
  await input.press("Enter");

  await expect(window).toHaveURL(/\/session\/[0-9a-f-]+/);
  // Scoped to the transcript: the prompt text also becomes the session's
  // optimistic title in the sidebar.
  const transcript = window.getByRole("log");
  await expect(transcript.getByText("Desktop SDK E2E", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Desktop fake Pi reply", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fs.existsSync(e2ePaths.fakePiLog) ? fs.readFileSync(e2ePaths.fakePiLog, "utf8") : "",
    )
    .toContain('"type":"prompt","message":"Desktop SDK E2E"');
});

test("reports a server crash and recovers on the pinned connection", async ({
  e2ePaths,
  window,
}) => {
  await waitForConnectedUi(window);
  const initialPid = await waitForServer(e2ePaths.pieHome);
  process.kill(initialPid, "SIGKILL");

  // The reconnecting overlay can be shorter than a Playwright polling tick on
  // fast machines, so the replacement discovery record is the stable barrier.
  await expect
    .poll(() => findServerPid(e2ePaths.pieHome) ?? initialPid, { timeout: 15_000 })
    .not.toBe(initialPid);
  await expect(window.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });

  const restartedPid = serverPid(e2ePaths.pieHome);
  expect(restartedPid).not.toBe(initialPid);
  await expect(window.getByText("Pie could not start")).toHaveCount(0);

  // A real app RPC after recovery proves the stable renderer adapter asked Main
  // for access to the replacement daemon instead of retaining the old token.
  await window.getByRole("combobox").filter({ hasText: "Select a project" }).click();
  await window.getByRole("option", { name: /e2e-workspace/ }).click();
  const input = window.locator("[contenteditable='true']").first();
  await input.fill("Prompt after daemon restart");
  await window.locator('button[type="submit"]').last().click();
  await expect
    .poll(() =>
      fs.existsSync(e2ePaths.fakePiLog) ? fs.readFileSync(e2ePaths.fakePiLog, "utf8") : "",
    )
    .toContain('"type":"prompt","message":"Prompt after daemon restart"');
});

test("leaves the daemon running through Electron shutdown", async ({
  e2ePaths,
  electronApp,
  window,
}) => {
  await expect(window).toHaveTitle("Pie");
  const pid = await waitForServer(e2ePaths.pieHome);

  await electronApp.close();

  // The server is the shared pie daemon the app attached to (or spawned) —
  // it deliberately outlives Electron so the CLI and the next app launch
  // converge on the same backend. `pie daemon stop` is how it ends (the
  // fixture teardown does the equivalent for the per-test daemon).
  await new Promise((resolve) => {
    setTimeout(resolve, 2_000);
  });
  expect(processExists(pid)).toBe(true);
});

test("offers Retry after repeated server failures", async ({ e2ePaths, window }) => {
  test.setTimeout(120_000);
  await driveServerToFailed(window, e2ePaths.pieHome);

  await expect(window.getByText("The local server stopped")).toBeVisible({ timeout: 10_000 });
  await window.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => findServerPid(e2ePaths.pieHome), { timeout: 10_000 }).toBeTruthy();
  await expect(window.getByText("The local server stopped")).toBeHidden({ timeout: 10_000 });
  // Wait for the recovery to complete, not just the respawn to appear: quitting
  // while the replacement server is still booting can hang the app shutdown
  // (known issue), and teardown closes the app right after this test ends.
  await expect(window.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
});

test("quits through Desktop RPC from the terminal failure state", async ({
  e2ePaths,
  electronApp,
  window,
}) => {
  test.setTimeout(120_000);
  const parentPid = appPid(electronApp);
  await driveServerToFailed(window, e2ePaths.pieHome);
  await expect(window.getByText("The local server stopped")).toBeVisible({ timeout: 10_000 });

  await window.getByRole("button", { name: "Quit" }).click();

  await expect.poll(() => processExists(parentPid), { timeout: 5_000 }).toBe(false);
});
