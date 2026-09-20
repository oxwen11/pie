import fs from "node:fs";
import path from "node:path";

import { type ElectronApplication, expect, test } from "@playwright/test";

import {
  awaitDesktopReady,
  closePieElectron,
  launchPieElectron,
  seedProject,
  stopDaemonFor,
} from "./fixtures.js";

test.setTimeout(120_000);

function readDaemonPid(pieHome: string): number | undefined {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(pieHome, "daemon", "daemon.pid"), "utf8"),
    ) as { pid?: number };
    return typeof record.pid === "number" && record.pid > 0 ? record.pid : undefined;
  } catch {
    return undefined;
  }
}

async function launchWindow(
  appPath: string,
  userData: string,
  pieHome: string,
): Promise<ElectronApplication> {
  fs.mkdirSync(userData, { recursive: true });
  const app = await launchPieElectron(appPath, userData, pieHome);
  const window = await app.firstWindow({ timeout: 30_000 });
  await awaitDesktopReady(window, pieHome);
  await expect(window.getByRole("combobox").filter({ hasText: "Choose project" })).toBeVisible({
    timeout: 30_000,
  });
  return app;
}

/**
 * Same `$PIE_HOME` must converge on one daemon — second Desktop attaches,
 * does not spawn a replacement while the first is still up.
 */
// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test("a second Desktop attaches to the running daemon", async ({}, testInfo) => {
  const root = testInfo.outputPath();
  const pieHome = path.join(root, "pie-home");
  fs.mkdirSync(pieHome, { recursive: true });
  seedProject(pieHome, path.join(root, "workspace"));
  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");

  let first: ElectronApplication | undefined;
  let second: ElectronApplication | undefined;
  try {
    first = await launchWindow(appPath, path.join(root, "user-data-a"), pieHome);
    await expect.poll(() => readDaemonPid(pieHome), { timeout: 30_000 }).toBeTruthy();
    const pid = readDaemonPid(pieHome);
    expect(pid).toBeTruthy();

    second = await launchWindow(appPath, path.join(root, "user-data-b"), pieHome);
    expect(readDaemonPid(pieHome)).toBe(pid);
  } finally {
    await closePieElectron(first);
    await closePieElectron(second);
    await stopDaemonFor(pieHome);
  }
});
