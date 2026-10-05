import fs from "node:fs";
import path from "node:path";

import { type ElectronApplication, expect, test } from "@playwright/test";

import { closeElectron, launchPieElectron, seedProject, stopDaemonFor } from "./fixtures.js";

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
  await expect(window).toHaveTitle("Pie");
  return app;
}

/**
 * The daemon outlives Electron. A later Desktop using the same `$PIE_HOME`
 * must attach to that daemon instead of spawning a replacement.
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

    await closeElectron(first);
    first = undefined;

    second = await launchWindow(appPath, path.join(root, "user-data-b"), pieHome);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000);
    });
    expect(readDaemonPid(pieHome)).toBe(pid);
  } finally {
    await closeElectron(first);
    await closeElectron(second);
    await stopDaemonFor(pieHome);
  }
});
