import fs from "node:fs";
import path from "node:path";

import { awaitDesktopReady, chatTest as test, expect } from "./fixtures.js";

test.use({ fakeReply: "![E2E local image](e2e-image.png)" });

test("decodes a live and replayed local Markdown image through a signed asset URL", async ({
  e2ePaths,
  window,
}, testInfo) => {
  test.setTimeout(180_000);
  fs.copyFileSync(
    path.join(import.meta.dirname, "../../resources/icon.png"),
    path.join(e2ePaths.workspace, "e2e-image.png"),
  );

  await awaitDesktopReady(window, e2ePaths.pieHome, 60_000);
  await window.getByRole("combobox").filter({ hasText: "Choose project" }).click();
  await window.getByRole("option", { name: /e2e-workspace/ }).click();
  await window.locator("[contenteditable='true']").fill("Render the local image");
  await window.locator('form button[type="submit"]').click();

  await expect(window).toHaveURL(/\/session\/[0-9a-f-]+/);
  const sessionUrl = window.url();
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

  await window.goto("pie://app/");
  await awaitDesktopReady(window, e2ePaths.pieHome, 60_000);
  const sessionButton = window.getByRole("button", {
    name: "Render the local image",
    exact: true,
  });
  await expect(sessionButton).toBeVisible({ timeout: 60_000 });
  await sessionButton.click();
  await expect(window).toHaveURL(sessionUrl);

  const replayed = window.getByRole("img", { name: "E2E local image" });
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
  await window.screenshot({ path: testInfo.outputPath("markdown-image-history.png") });
});
