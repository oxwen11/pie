import type { Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

import {
  appDistExists,
  PROJECT_ID,
  seedProject,
  startPieServe,
} from "../../../../tools/testing/e2e-web.js";

export const FAKE_REPLY = "E2E fake Pi reply";

export type PieHarness = {
  readonly baseUrl: string;
  readonly projectId: string;
};

export const test = base.extend<{ pie: PieHarness }>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  pie: async ({}, use, testInfo) => {
    if (!appDistExists()) {
      throw new Error(
        "apps/app/dist is missing — run `pnpm turbo run e2e --filter=@getpie/app` (e2e dependsOn build)",
      );
    }
    const pieHome = testInfo.outputPath("pie-home");
    seedProject(pieHome, testInfo.outputPath("workspace"));
    const serve = await startPieServe({
      pieHome,
      fakePiLog: testInfo.outputPath("fake-pi.jsonl"),
      fakePiResponse: FAKE_REPLY,
    });
    await use({ baseUrl: serve.baseUrl, projectId: PROJECT_ID });
    serve.stop();
  },
});

export { expect, PROJECT_ID };

/** Contenteditable composer. Enter is a newline / CDP Enter does not submit. */
export const composer = (page: Page) => page.locator('[contenteditable="true"]').first();

export const sendButton = (page: Page) => page.getByRole("button", { name: "Send message" });
