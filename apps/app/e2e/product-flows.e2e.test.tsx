import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
  fillComposer,
  importFolder,
  openImportDialog,
  selectDraftProject,
  sendSessionMessage,
  submitDraftComposer,
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
    expect(page.getByRole("heading", { name: "New chat" }).query()).not.toBeNull();

    await openImportDialog("empty");
    await importFolder(sample());

    await waitForText("Ask Pi anything...");
    await waitForText(sample());
    expect(window.location.pathname).toBe("/draft");
    expect(window.location.search).toContain("projectId=");
  });

  it("sends a draft and opens a session with user and assistant turns", async () => {
    await mountApp();
    await waitForText("Ask Pi anything...");
    await selectDraftProject(sample());
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
    await page.getByText(FIRST_PROMPT, { exact: true }).click();
    await expect.poll(() => window.location.pathname).toMatch(/\/session\//);

    await fillComposer(FOLLOW_UP);
    await sendSessionMessage();
    await waitForText(FOLLOW_UP);
    expect(page.getByText(fakeReply()).nth(1).query()).not.toBeNull();
  });
});

describe("composer and model picker", () => {
  it("keeps the draft composer usable and opens the picker when models exist", async () => {
    await mountApp();
    await waitForText("Ask Pi anything...");
    await selectDraftProject(sample());
    expect(page.locator('[contenteditable="true"]').query()).not.toBeNull();

    const trigger = page.locator('[data-slot="model-selector-trigger"]');
    await vi.waitFor(
      () => {
        const picker = trigger.query();
        const composer = page.getByText("Ask Pi anything...").query();
        if (picker === null && composer === null) {
          throw new Error("draft composer disappeared before models resolved");
        }
      },
      { timeout: 5_000 },
    );
    if (trigger.query() !== null) {
      await trigger.click();
      await waitForText("Search models");
    }
    expect(page.locator('[contenteditable="true"]').query()).not.toBeNull();
  });
});

describe("sidebar and content panel", () => {
  it("opens New chat and the per-project compose entry", async () => {
    await mountApp();
    await waitForText(sample());
    await page.getByRole("link", { name: "New chat" }).click();
    await expect.poll(() => window.location.pathname).toBe("/draft");
    await waitForText("Ask Pi anything...");

    await page.getByTitle(`New chat in ${sample()}`).click();
    await expect.poll(() => window.location.search).toContain("projectId=");
    await waitForText(sample());
  });

  it("renames the session from the row menu", async () => {
    await mountApp();
    await waitForText(FIRST_PROMPT);
    await page.getByText(FIRST_PROMPT, { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await waitForText("Rename session");
    const title = page.getByLabelText("Title");
    await title.fill(RENAMED);
    await page.getByRole("button", { name: /save|rename/i }).click();
    await waitForText(RENAMED);
    expect(page.getByText(RENAMED).query()).not.toBeNull();
  });

  it("opens Files from the content panel", async () => {
    await mountApp();
    await page.getByText(RENAMED).click();
    await expect.poll(() => window.location.pathname).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Files" }).click();
    expect(page.getByLabelText("Project files").query()).not.toBeNull();
    await waitForText("README.md");
    await page.getByText("README.md", { exact: true }).click();
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
    expect(page.getByText("e2e nightly").query()).not.toBeNull();
  });

  it("opens the pull-request page empty state", async () => {
    await mountApp();
    await page.getByRole("link", { name: "Pull Request" }).click();
    await waitForText("No open pull requests");
    expect(page.getByText("No open pull requests").query()).not.toBeNull();
  });
});
