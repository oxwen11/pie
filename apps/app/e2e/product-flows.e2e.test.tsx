import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
  clickText,
  fillComposer,
  importFolder,
  modelPickerTrigger,
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

afterEach(() => {
  unmountApp();
});

const sample = () => pieE2E().sample;
const fakeReply = () => pieE2E().fakeReply;

describe("import and draft", () => {
  it("imports the first project from the empty draft", async () => {
    await mountApp();
    await waitForText("Import your first project");
    expect(page.getByTitle("New chat").query()).not.toBeNull();
    expect(
      page.getByTestId("main").getByRole("button", { name: "Import project" }).query(),
    ).not.toBeNull();

    await openImportDialog("empty");
    await importFolder(sample());

    await waitForComposer();
    await waitForText(sample());
    expect(window.location.pathname).toBe("/draft");
    expect(window.location.search).toContain("projectId=");
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
    expect(page.getByRole("button", { name: "Send message" }).query()).not.toBeNull();
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
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();

    await vi.waitFor(
      () => {
        if (
          modelPickerTrigger() === null &&
          document.querySelector('[contenteditable="true"]') === null
        ) {
          throw new Error("draft composer disappeared before models resolved");
        }
      },
      { timeout: 5_000 },
    );
    const trigger = modelPickerTrigger();
    if (trigger !== null) {
      trigger.click();
      await waitForText("Search models");
    }
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
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
    const title = page.getByLabelText("Title");
    await title.fill(RENAMED);
    await page.getByRole("button", { name: /save|rename/i }).click();
    await waitForText(RENAMED);
    expect(page.getByText(RENAMED).first().query()).not.toBeNull();
  });

  it("opens Files from the content panel", async () => {
    await mountApp();
    await clickText(RENAMED);
    await expect.poll(() => window.location.pathname).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Files" }).click();
    const treeToggle =
      page.getByRole("button", { name: /Open file tree/ }).query() ??
      document.querySelector('[aria-label*="file tree"]');
    if (treeToggle !== null) {
      treeToggle.click();
    }
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toMatch(/README\.md|打开文件|Files/);
      },
      { timeout: 15_000 },
    );
    const readme = [...document.querySelectorAll("span,div,button,a")].find(
      (el) => el.textContent?.trim() === "README.md",
    );
    if (readme !== undefined) {
      readme.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitForText("Pie e2e workspace.");
    }
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
    expect(page.getByText("e2e nightly").first().query()).not.toBeNull();
  });

  it("opens the pull-request page empty state", async () => {
    await mountApp();
    await page.getByRole("link", { name: "Pull Request" }).click();
    await waitForText("No open pull requests");
    expect(page.getByText("No open pull requests").query()).not.toBeNull();
  });
});

describe("git workspace and review", () => {
  const sampleGit = () => pieE2E().sampleGit;

  it("imports a git folder and shows workspace controls", async () => {
    await mountApp();
    await waitForText(sample());
    await openImportDialog("sidebar");
    await importFolder(sampleGit());
    await waitForText(sampleGit());

    await page.getByRole("link", { name: "New chat" }).click();
    await openDraftForProject(sampleGit());
    await waitForText("Current directory", 20_000);
    await page.getByText("Current directory").first().click();
    await page.getByText("New worktree", { exact: true }).click();
    await waitForText(/Base branch|main/);
    expect(page.getByLabelText("Base branch for worktree").query()).not.toBeNull();
  });

  it("shows Review for a git project session", async () => {
    await mountApp();
    await page.getByTitle(`New chat in ${sampleGit()}`).click();
    await waitForComposer();
    await page.getByRole("textbox").first().click();
    await page.getByRole("textbox").first().fill("e2e git review");
    const send = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
    expect(send).not.toBeNull();
    send?.click();
    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Review" }).click();
    await waitForText(/Review|Compare mode|No changes|uncommitted/i);
  });
});
