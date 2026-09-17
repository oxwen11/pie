import { expect, vi } from "vitest";
import { page } from "vitest/browser";

export async function waitForText(text: string | RegExp, timeout = 15_000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(page.getByText(text).first().query()).not.toBeNull();
    },
    { timeout },
  );
}

export function composer(): HTMLElement | null {
  return document.querySelector('[contenteditable="true"]');
}

export async function waitForComposer(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(composer()).not.toBeNull();
    },
    { timeout: 15_000 },
  );
}

export async function clickText(text: string): Promise<void> {
  await page.getByText(text, { exact: true }).first().click();
}

export async function openImportDialog(from: "empty" | "sidebar"): Promise<void> {
  if (from === "empty") {
    await page.getByTestId("main").getByRole("button", { name: "Import project" }).click();
  } else {
    await page.getByTestId("sidebar").getByTitle("Import project").click();
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

export async function openDraftForProject(name: string): Promise<void> {
  await page.getByTitle(`New chat in ${name}`).click();
  await waitForComposer();
}

export async function fillComposer(text: string): Promise<void> {
  await waitForComposer();
  const editor = page.getByRole("textbox").first();
  await editor.click();
  await editor.fill(text);
}

export async function submitDraftComposer(): Promise<void> {
  const send = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
  expect(send).not.toBeNull();
  send?.click();
}

export async function sendSessionMessage(): Promise<void> {
  await page.getByRole("button", { name: "Send message" }).click();
}

export function modelPickerTrigger(): HTMLElement | null {
  return document.querySelector('[data-slot="model-selector-trigger"]');
}
