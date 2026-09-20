import fs from "node:fs";
import path from "node:path";

import { type ElectronApplication, expect, test } from "@playwright/test";

import { awaitDesktopReady, launchPieElectron, stopDaemonFor } from "./fixtures.js";

const SAMPLE = "desktop-import-sample";

/**
 * Empty-home Import — desktop-specific: no seeded projects.json, picker
 * confined to a browse root (same shape as pie-verify --empty-projects).
 */
// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test("imports the first project from the empty draft", async ({}, testInfo) => {
  const root = testInfo.outputPath();
  const pieHome = path.join(root, "pie-home");
  const userData = path.join(root, "user-data");
  const browseRoot = path.join(root, "browse");
  const sample = path.join(browseRoot, SAMPLE);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(sample, { recursive: true });
  fs.writeFileSync(path.join(sample, "README.md"), "# desktop import sample\n");
  // Leave projects.json absent — first launch must create storage itself.

  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
  let app: ElectronApplication | undefined;
  try {
    app = await launchPieElectron(appPath, userData, pieHome, {
      PIE_PROJECT_BROWSE_ROOT: browseRoot,
    });

    const window = await app.firstWindow({ timeout: 30_000 });
    await awaitDesktopReady(window, pieHome);
    // No empty-state control anymore (#288) — the sidebar action is the entry.
    await window.getByTestId("sidebar").getByTitle("Import project").click();
    await expect(window.getByPlaceholder("Search folders or enter a full path...")).toBeVisible({
      timeout: 15_000,
    });
    await window.getByText(SAMPLE, { exact: true }).click();
    const importButton = window.getByRole("button", { name: "Import this folder" });
    await expect(importButton).toBeEnabled({ timeout: 10_000 });
    await importButton.click();

    await expect(window.getByText(SAMPLE).first()).toBeVisible({ timeout: 15_000 });
    const projects = JSON.parse(
      fs.readFileSync(path.join(pieHome, "storage", "projects.json"), "utf8"),
    ) as { data: Array<{ name: string; path: string }> };
    expect(projects.data.some((project) => project.name === SAMPLE)).toBe(true);
  } finally {
    await app?.close();
    await stopDaemonFor(pieHome);
  }
});
