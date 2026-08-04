import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Browser-mode multi-client session sync. Unlike the Electron spec, this
 * drives `vibest serve` (the daemon's foreground form) plus two ordinary
 * browser pages on the same session — the shape multi-client sync exists for.
 *
 * The harness is the fake Claude executable, so scenarios are limited to what
 * it can produce: instant single-message turns, no tool calls, and no on-disk
 * transcript. The last one matters: a client attaching after a turn ended
 * cannot backfill it from history (the real fix for that is a history read),
 * so every assertion below is about turns a client either observed live or
 * recovered from the runtime snapshot.
 *
 * Prerequisite: the SPA must be built (`turbo run build --filter=@vibest/app`)
 * — serve has no dev branch and serves `apps/app/dist` statically.
 */

const repoRoot = path.join(import.meta.dirname, "../../../..");
const appDist = path.join(repoRoot, "apps/app/dist");
const fakeClaude = path.join(repoRoot, "tools/testing/fake-claude.mjs");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FAKE_REPLY = "E2E fake Claude reply";

test.skip(
  !fs.existsSync(path.join(appDist, "index.html")),
  "apps/app/dist is missing — build the SPA first (turbo run build --filter=@vibest/app)",
);

let server: childProcess.ChildProcessWithoutNullStreams | undefined;
let baseUrl = "";

// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test.beforeAll(async ({}, testInfo) => {
  const home = testInfo.outputPath("vibest-home");
  const workspace = testInfo.outputPath("workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const storage = path.join(home, "storage");
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

  server = childProcess.spawn(
    path.join(repoRoot, "node_modules/.bin/tsx"),
    [path.join(repoRoot, "packages/vibest/src/node/cli.ts"), "serve"],
    {
      env: {
        ...process.env,
        VIBEST_PORT: "0",
        VIBEST_HOME: home,
        VIBEST_E2E: "1",
        VIBEST_E2E_CLAUDE_EXECUTABLE: fakeClaude,
        VIBEST_E2E_CLAUDE_LOG: testInfo.outputPath("fake-claude.jsonl"),
        VIBEST_E2E_CLAUDE_RESPONSE: FAKE_REPLY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  baseUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`vibest serve never became ready:\n${output}`)),
      30_000,
    );
    const scan = (chunk: Buffer) => {
      output += chunk.toString();
      const ready = output.match(/vibest:ready\s*({.+})/);
      if (ready?.[1]) {
        clearTimeout(timeout);
        const { port } = JSON.parse(ready[1]) as { port: number };
        resolve(`http://127.0.0.1:${port}`);
      }
    };
    server?.stdout.on("data", scan);
    server?.stderr.on("data", scan);
    server?.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`vibest serve exited with ${code}:\n${output}`));
    });
  });
});

test.afterAll(() => {
  server?.kill("SIGTERM");
  server = undefined;
});

const send = async (page: Page, text: string) => {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.pressSequentially(text);
  // Enter is a newline in the composer; submission is the button.
  await page.locator('button[type="submit"]').last().click();
};

/** Create a session through the draft surface (the real `open` path) and
 * return once the first turn's reply landed. */
const createSession = async (browser: Browser, firstPrompt: string): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Draft config lives in the URL, so the project and harness are picked
  // deterministically instead of driving two dropdowns.
  await page.goto(`${baseUrl}/draft?projectId=${PROJECT_ID}&harness=claude-code`);
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 20_000 });
  await send(page, firstPrompt);
  await page.waitForURL(/\/session\//, { timeout: 20_000 });
  await expect(page.getByText(FAKE_REPLY).first()).toBeVisible({ timeout: 15_000 });
  return page;
};

const joinSession = async (browser: Browser, sessionUrl: string): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(sessionUrl);
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 20_000 });
  return page;
};

test("two clients on one session render each other's turns live", async ({ browser }) => {
  const pageA = await createSession(browser, "first prompt from A");
  const pageB = await joinSession(browser, pageA.url());

  // A → B: the prompt broadcast and the folded turn reach the observer.
  await send(pageA, "second prompt from A");
  await expect(pageB.getByText("second prompt from A")).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByText(FAKE_REPLY).first()).toBeVisible({ timeout: 15_000 });

  // B → A: same path in the other direction — no client is special.
  await send(pageB, "hello from client B");
  await expect(pageA.getByText("hello from client B")).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByText(FAKE_REPLY)).toHaveCount(3, { timeout: 15_000 });
  await expect(pageB.getByText(FAKE_REPLY)).toHaveCount(2, { timeout: 15_000 });
});

test("a disconnected client recovers a turn it missed, without a reload", async ({ browser }) => {
  const pageA = await createSession(browser, "warm-up turn");
  const pageB = await joinSession(browser, pageA.url());

  // Sever B's network: its WebSocket (and the event stream on it) drops.
  await pageB.context().setOffline(true);
  await send(pageA, "sent while B was offline");
  await expect(pageA.getByText(FAKE_REPLY)).toHaveCount(2, { timeout: 15_000 });
  // The drop must be real: an offline B cannot have seen the turn live. If
  // this fires, setOffline failed to sever the socket and the recovery
  // assertion below would pass vacuously.
  await expect(pageB.getByText("sent while B was offline")).toBeHidden();

  // Back online: the transport's retry loop re-attaches on its own, and the
  // snapshot replays the retained prompt and completed turn buffer.
  await pageB.context().setOffline(false);
  await expect(pageB.getByText("sent while B was offline")).toBeVisible({ timeout: 30_000 });
  await expect(pageB.getByText(FAKE_REPLY).first()).toBeVisible({ timeout: 30_000 });
});
