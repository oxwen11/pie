import { expect, vi } from "vitest";
import { page } from "vitest/browser";

export async function waitForText(text: string | RegExp, timeout = 15_000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(page.getByText(text).query()).not.toBeNull();
    },
    { timeout },
  );
}

export async function openImportDialog(from: "empty" | "sidebar"): Promise<void> {
  if (from === "empty") {
    await page.getByRole("button", { name: "Import project" }).click();
  } else {
    await page.getByTitle("Import project").click();
  }
  await vi.waitFor(
    () => {
      expect(
        page.getByPlaceholder("Search folders or enter a full path...").query(),
      ).not.toBeNull();
    },
    { timeout: 10_000 },
  );
}

export async function importFolder(name: string): Promise<void> {
  await page.getByText(name, { exact: true }).click();
  const importButton = page.getByRole("button", { name: "Import this folder" });
  await vi.waitFor(
    () => {
      expect(importButton.query()).not.toBeNull();
      expect(importButton.element().hasAttribute("disabled")).toBe(false);
    },
    { timeout: 10_000 },
  );
  await importButton.click();
}

export async function selectDraftProject(name: string): Promise<void> {
  const trigger = page.getByText("Select a project");
  if (trigger.query()?.isVisible()) {
    await trigger.click();
    await page.getByRole("option", { name }).click();
  }
}

export async function fillComposer(text: string): Promise<void> {
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.fill(text);
}

export async function submitDraftComposer(): Promise<void> {
  await page.locator("form").getByRole("button").last().click();
}

export async function sendSessionMessage(): Promise<void> {
  await page.getByRole("button", { name: "Send message" }).click();
}
