import fs from "node:fs";
import path from "node:path";

import { _electron as electron } from "@playwright/test";

import { expect, test } from "./fixtures.js";

test.use({ fakePiResponse: "![E2E local image](e2e-image.png)" });

test("decodes a live and replayed local Markdown image through a signed asset URL", async ({
  e2ePaths,
  electronApp,
  window,
}, testInfo) => {
  fs.copyFileSync(
    path.join(import.meta.dirname, "../../resources/icon.png"),
    path.join(e2ePaths.workspace, "e2e-image.png"),
  );

  await expect(window.getByRole("main", { name: "Starting Pie" })).toBeHidden({
    timeout: 30_000,
  });
  await window.getByRole("combobox").filter({ hasText: "Select a project" }).click();
  await window.getByRole("option", { name: /e2e-workspace/ }).click();
  await window.locator("[contenteditable='true']").fill("Render the local image");
  await window.locator("[contenteditable='true']").press("Enter");

  await expect(window).toHaveURL(/\/session\/[0-9a-f-]+/);
  const image = window.getByRole("img", { name: "E2E local image" });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return {
          complete: img.complete,
          naturalHeight: img.naturalHeight,
          naturalWidth: img.naturalWidth,
          origin: location.origin,
          src: img.currentSrc,
        };
      }),
    )
    .toMatchObject({
      complete: true,
      naturalHeight: 512,
      naturalWidth: 512,
      origin: "pie://app",
    });

  const live = await image.evaluate((element) => {
    const img = element as HTMLImageElement;
    return { src: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(live.src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/assets\//);
  const response = await fetch(live.src);
  const assetResponse = {
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    nosniff: response.headers.get("x-content-type-options"),
    status: response.status,
  };
  expect(assetResponse).toEqual({
    cacheControl: "private, no-store",
    contentType: "image/png",
    nosniff: "nosniff",
    status: 200,
  });

  await window.screenshot({ path: testInfo.outputPath("markdown-image-live.png") });
  await electronApp.close();

  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
  const fakePiPath = path.join(import.meta.dirname, "../../../../tools/testing/fake-pi.mjs");
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...launchEnv } = process.env;
  const replayApp = await electron.launch({
    args: [appPath, `--user-data-dir=${e2ePaths.userData}`],
    env: {
      ...launchEnv,
      NODE_ENV: "test",
      PIE_E2E: "1",
      PIE_E2E_PI_EXECUTABLE: fakePiPath,
      PIE_E2E_PI_LOG: e2ePaths.fakePiLog,
      PIE_E2E_PI_RESPONSE: "![E2E local image](e2e-image.png)",
      PIE_HOME: e2ePaths.pieHome,
    },
  });

  try {
    const replayWindow = await replayApp.firstWindow({ timeout: 30_000 });
    await expect(replayWindow.getByRole("main", { name: "Starting Pie" })).toBeHidden({
      timeout: 30_000,
    });
    await replayWindow.getByRole("button", { name: "Render the local image", exact: true }).click();

    const replayed = replayWindow.getByRole("img", { name: "E2E local image" });
    await expect(replayed).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        replayed.evaluate((element) => {
          const img = element as HTMLImageElement;
          return {
            complete: img.complete,
            height: img.naturalHeight,
            origin: location.origin,
            src: img.currentSrc,
            width: img.naturalWidth,
          };
        }),
      )
      .toMatchObject({ complete: true, height: 512, origin: "pie://app", width: 512 });
    const replayedSrc = await replayed.evaluate(
      (element) => (element as HTMLImageElement).currentSrc,
    );
    expect(replayedSrc).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/assets\//);
    await replayWindow.screenshot({ path: testInfo.outputPath("markdown-image-history.png") });
  } finally {
    await replayApp.close();
  }
});
