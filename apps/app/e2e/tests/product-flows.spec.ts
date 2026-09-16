import { expect, test } from "../fixtures.js";
import {
  clickText,
  fillComposer,
  importFolder,
  openApp,
  openDraftForProject,
  openImportDialog,
  pathname,
  sendSessionMessage,
  submitDraftComposer,
  waitForComposer,
  waitForText,
} from "../helpers.js";

const FIRST_PROMPT = "e2e first prompt";
const FOLLOW_UP = "e2e follow-up";
const RENAMED = "renamed e2e chat";

test.describe.configure({ mode: "serial" });

test.describe("import and draft", () => {
  test("imports the first project from the empty draft", async ({ page, pie }) => {
    await openApp(page);
    await waitForText(page, "Import your first project");
    await expect(page.getByTitle("New chat")).toBeVisible();
    await expect(
      page.getByTestId("main").getByRole("button", { name: "Import project" }),
    ).toBeVisible();

    await openImportDialog(page, "empty");
    await importFolder(page, pie.sample);

    await waitForComposer(page);
    await waitForText(page, pie.sample);
    expect(pathname(page)).toBe("/draft");
    expect(new URL(page.url()).search).toContain("projectId=");
  });

  test("sends a draft and opens a session with user and assistant turns", async ({ page, pie }) => {
    await openApp(page);
    await waitForText(page, pie.sample);
    await openDraftForProject(page, pie.sample);
    await fillComposer(page, FIRST_PROMPT);
    await submitDraftComposer(page);

    await expect.poll(() => pathname(page), { timeout: 15_000 }).toMatch(/\/session\//);
    await waitForText(page, FIRST_PROMPT);
    await waitForText(page, pie.fakeReply);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });

  test("sends a follow-up on the open session", async ({ page, pie }) => {
    await openApp(page);
    await waitForText(page, pie.sample);
    await clickText(page, FIRST_PROMPT);
    await expect.poll(() => pathname(page)).toMatch(/\/session\//);

    await fillComposer(page, FOLLOW_UP);
    await sendSessionMessage(page);
    await waitForText(page, FOLLOW_UP);
    await waitForText(page, /Thinking|E2E fake Pi reply/, 20_000);
  });
});

test.describe("composer and model picker", () => {
  test("keeps the draft composer usable and opens the picker when models exist", async ({
    page,
    pie,
  }) => {
    await openApp(page);
    await waitForText(page, pie.sample);
    await openDraftForProject(page, pie.sample);
    await waitForComposer(page);

    const trigger = page.locator('[data-slot="model-selector-trigger"]');
    if ((await trigger.count()) > 0) {
      await trigger.click();
      await waitForText(page, "Search models");
    }
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  });
});

test.describe("sidebar and content panel", () => {
  test("opens New chat and the per-project compose entry", async ({ page, pie }) => {
    await openApp(page);
    await waitForText(page, pie.sample);
    await page.getByRole("link", { name: "New chat", exact: true }).click();
    await expect.poll(() => pathname(page)).toBe("/draft");
    await waitForComposer(page);

    await page.getByTitle(`New chat in ${pie.sample}`).click();
    await expect.poll(() => new URL(page.url()).search).toContain("projectId=");
    await waitForText(page, pie.sample);
  });

  test("renames the session from the row menu", async ({ page }) => {
    await openApp(page);
    await waitForText(page, FIRST_PROMPT);
    await page.getByText(FIRST_PROMPT, { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await waitForText(page, "Rename session");
    await page.getByLabel("Title").fill(RENAMED);
    await page.getByRole("button", { name: /save|rename/i }).click();
    await waitForText(page, RENAMED);
    await expect(page.getByText(RENAMED).first()).toBeVisible();
  });

  test("opens Files from the content panel", async ({ page }) => {
    await openApp(page);
    await clickText(page, RENAMED);
    await expect.poll(() => pathname(page)).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText(page, "Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Files" }).click();
    const treeToggle = page.getByRole("button", { name: /file tree/i });
    if ((await treeToggle.count()) > 0) {
      await treeToggle.click();
    }
    await expect(page.getByText(/README\.md|打开文件|Files/).first()).toBeVisible({
      timeout: 15_000,
    });
    const readme = page.getByText("README.md", { exact: true }).first();
    if ((await readme.count()) > 0) {
      await readme.click();
      await waitForText(page, "Pie e2e workspace.");
    }
  });
});

test.describe("schedules and pull requests", () => {
  test("opens Scheduled and creates a schedule", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Scheduled" }).click();
    await waitForText(page, "No schedules yet");
    await page.getByRole("button", { name: "New schedule" }).click();
    await waitForText(page, "New schedule");
    await page.getByLabel("Name").fill("e2e nightly");
    await page.getByLabel("Prompt").fill("e2e scheduled ping");
    await page.getByRole("button", { name: /create|save/i }).click();
    await waitForText(page, "e2e nightly");
    await expect(page.getByText("e2e nightly").first()).toBeVisible();
  });

  test("opens the pull-request page empty state", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Pull Request" }).click();
    await expect.poll(() => pathname(page)).toBe("/pull-requests");
    await waitForText(page, "No open pull requests");
    await expect(page.getByText("No open pull requests")).toBeVisible();
  });
});

test.describe("git workspace and review", () => {
  test("imports a git folder and shows workspace controls", async ({ page, pie }) => {
    await openApp(page);
    await waitForText(page, pie.sample);
    await openImportDialog(page, "sidebar");
    await importFolder(page, pie.sampleGit);
    await waitForText(page, pie.sampleGit);

    await page.getByRole("link", { name: "New chat", exact: true }).click();
    await openDraftForProject(page, pie.sampleGit);
    await waitForText(page, "Current directory", 20_000);
    await page.getByText("Current directory").first().click();
    await page.getByText("New worktree", { exact: true }).click();
    await waitForText(page, /Base branch|main/);
    await expect(page.getByLabel("Base branch for worktree")).toBeVisible();
  });

  test("shows Review for a git project session", async ({ page, pie }) => {
    await openApp(page);
    await page.getByTitle(`New chat in ${pie.sampleGit}`).click();
    await waitForComposer(page);
    await page.getByRole("textbox").first().click();
    await page.getByRole("textbox").first().fill("e2e git review");
    await page.locator('form button[type="submit"]').click();
    await expect.poll(() => pathname(page), { timeout: 15_000 }).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText(page, "Choose what to show alongside the chat.");
    await page.getByTestId("content").getByRole("button", { name: "Review" }).click();
    await waitForText(page, /Review|Compare mode|No changes|uncommitted/i);
  });
});
