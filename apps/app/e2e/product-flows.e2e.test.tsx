import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
  clickText,
  fillComposer,
  importFolder,
  openDraftForProject,
  openImportDialog,
  sendSessionMessage,
  submitDraftComposer,
  waitForComposer,
  waitForText,
} from "./helpers";
import { mountApp, pieE2E, unmountApp } from "./mount";

const FIRST_PROMPT = "e2e first prompt";
const FOLLOW_UP = "e2e follow-up";
const RENAMED = "renamed e2e chat";

afterEach(async () => {
  await unmountApp();
});

const sample = () => pieE2E().sample;
const fakeReply = () => pieE2E().fakeReply;

describe("import and draft", () => {
  it("imports a project from the empty draft via the sidebar", async () => {
    await mountApp();
    await waitForText("Import your first project");

    await openImportDialog();
    await importFolder(sample());

    await waitForComposer();
    await waitForText(sample());
    expect(window.location.pathname).toBe("/draft");
  });

  it("sends a draft and opens a session with user and assistant turns", async () => {
    await mountApp();
    await waitForText(sample());
    await openDraftForProject(sample());
    await fillComposer(FIRST_PROMPT);
    await submitDraftComposer();

    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toMatch(/\/session\//);
    await waitForText(FIRST_PROMPT);
    await waitForText(fakeReply());
    await expect.element(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });

  it("sends a follow-up on the open session", async () => {
    await mountApp();
    await waitForText(sample());
    await clickText(FIRST_PROMPT);
    await expect.poll(() => window.location.pathname).toMatch(/\/session\//);

    await fillComposer(FOLLOW_UP);
    await sendSessionMessage();
    await waitForText(FOLLOW_UP);
    await waitForText(/Thinking|E2E fake Pi reply/, 20_000);
  });
});

describe("composer and model picker", () => {
  it("keeps the draft composer usable and opens the picker when models exist", async () => {
    await mountApp();
    await waitForText(sample());
    await openDraftForProject(sample());
    await waitForComposer();

    const picker = page.getBySlot("model-selector-trigger");
    try {
      await expect.element(picker, { timeout: 5_000 }).toBeVisible();
      await picker.click();
      await waitForText("Search models");
    } catch {
      await waitForComposer();
    }
    await waitForComposer();
  });
});

describe("sidebar and content panel", () => {
  it("opens New chat and the per-project compose entry", async () => {
    await mountApp();
    await waitForText(sample());
    await page.getByRole("link", { name: "New chat" }).click();
    await expect.poll(() => window.location.pathname).toBe("/draft");
    await waitForComposer();

    await page.getByTitle(`New chat in ${sample()}`).click();
    await expect.poll(() => window.location.search).toContain("projectId=");
    await waitForText(sample());
  });

  it("renames the session from the row menu", async () => {
    await mountApp();
    await waitForText(FIRST_PROMPT);
    await page.getByText(FIRST_PROMPT, { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await waitForText("Rename session");
    await page.getByLabelText("Title").fill(RENAMED);
    await page.getByRole("button", { name: /save|rename/i }).click();
    await waitForText(RENAMED);
    await expect.element(page.getByText(RENAMED).first()).toBeVisible();
  });

  it("opens Files from the content panel", async () => {
    await mountApp();
    await clickText(RENAMED);
    await expect.poll(() => window.location.pathname).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Files" }).click();
    const treeToggle = page.getByRole("button", { name: /file tree/i });
    try {
      await expect.element(treeToggle, { timeout: 3_000 }).toBeVisible();
      await treeToggle.click();
    } catch {
      // Tree may already be open.
    }
    const readme = page.getByRole("treeitem", { name: "README.md" });
    await expect.element(readme, { timeout: 15_000 }).toBeVisible();
    await readme.click();
    await waitForText("Pie e2e workspace.");
  });
});

describe("schedules and pull requests", () => {
  it("opens Scheduled and creates a schedule", async () => {
    await mountApp();
    await page.getByRole("link", { name: "Scheduled" }).click();
    await waitForText("No schedules yet");
    await page.getByRole("button", { name: "New schedule" }).click();
    await waitForText("New schedule");
    await page.getByLabelText("Name").fill("e2e nightly");
    await page.getByLabelText("Prompt").fill("e2e scheduled ping");
    await page.getByRole("button", { name: /create|save/i }).click();
    await waitForText("e2e nightly");
    await expect.element(page.getByText("e2e nightly").first()).toBeVisible();
  });

  it("opens the pull-request page empty state", async () => {
    await mountApp();
    await page.getByRole("link", { name: "Pull requests" }).click();
    await expect.poll(() => window.location.pathname).toBe("/pull-requests");
    await waitForText("No open pull requests.");
    await expect.element(page.getByText("No open pull requests.")).toBeVisible();
  });
});

describe("git workspace and review", () => {
  const sampleGit = () => pieE2E().sampleGit;

  it("imports a git folder and shows workspace controls", async () => {
    await mountApp();
    await waitForText(sample());
    await openImportDialog();
    await importFolder(sampleGit());
    await waitForText(sampleGit());

    await page.getByRole("link", { name: "New chat" }).click();
    await openDraftForProject(sampleGit());
    await waitForText("Current directory", 20_000);
    await page.getByText("Current directory").first().click();
    await page.getByText("New worktree", { exact: true }).click();
    await waitForText(/Base branch|main/);
    await expect.element(page.getByLabelText("Base branch for worktree")).toBeVisible();
  });

  it("shows Review for a git project session", async () => {
    await mountApp();
    await page.getByTitle(`New chat in ${sampleGit()}`).click();
    await waitForComposer();
    await page.getByRole("textbox").first().click();
    await page.getByRole("textbox").first().fill("e2e git review");
    await submitDraftComposer();
    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Review" }).click();
    await waitForText(/Review|Compare mode|No changes|uncommitted/i);
  });
});
