import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { importFolder, openImportDialog, selectDraftProject, waitForText } from "./helpers";
import { mountApp, pieE2E, unmountApp } from "./mount";

afterEach(() => {
  unmountApp();
});

const sampleGit = () => pieE2E().sampleGit;

describe("git workspace and review", () => {
  it("imports a git folder and shows workspace controls", async () => {
    await mountApp();
    await waitForText("New chat");
    await openImportDialog("sidebar");
    await importFolder(sampleGit());
    await waitForText(sampleGit());

    await page.getByRole("link", { name: "New chat" }).click();
    await waitForText("Ask Pi anything...");
    await selectDraftProject(sampleGit());
    await waitForText("Current directory");
    await page.getByRole("combobox", { name: /workspace|current directory/i }).click();
    await page.getByRole("option", { name: "New worktree" }).click();
    expect(page.getByLabelText("Base branch for worktree").query()).not.toBeNull();
  });

  it("shows Review for a git project session", async () => {
    await mountApp();
    await page.getByTitle(`New chat in ${sampleGit()}`).click();
    await waitForText("Ask Pi anything...");
    const editor = page.locator('[contenteditable="true"]');
    await editor.click();
    await editor.fill("e2e git review");
    await page.locator("form").getByRole("button").last().click();
    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Review" }).click();
    await waitForText(/Review|Compare mode|No changes|uncommitted/i);
  });
});
