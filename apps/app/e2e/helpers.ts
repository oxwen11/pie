import { type Page, expect } from "@playwright/test";

import { pieE2E } from "./fixtures.js";

export async function openApp(page: Page): Promise<void> {
  await page.goto(pieE2E().httpBaseUrl);
}

export async function waitForText(
  page: Page,
  text: string | RegExp,
  timeout = 15_000,
): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout });
}

export async function waitForComposer(page: Page): Promise<void> {
  await expect(page.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
}

export async function clickText(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).first().click();
}

export async function openImportDialog(page: Page, from: "empty" | "sidebar"): Promise<void> {
  if (from === "empty") {
    await page.getByTestId("main").getByRole("button", { name: "Import project" }).click();
  } else {
    await page.getByTestId("sidebar").getByTitle("Import project").click();
  }
  await expect(page.getByPlaceholder("Search folders or enter a full path...")).toBeVisible({
    timeout: 10_000,
  });
}

export async function importFolder(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: true }).click();
  const importButton = page.getByRole("button", { name: "Import this folder" });
  await expect(importButton).toBeEnabled({ timeout: 10_000 });
  await importButton.click();
}

export async function openDraftForProject(page: Page, name: string): Promise<void> {
  await page.getByTitle(`New chat in ${name}`).click();
  await waitForComposer(page);
}

export async function fillComposer(page: Page, text: string): Promise<void> {
  await waitForComposer(page);
  const editor = page.getByRole("textbox").first();
  await editor.click();
  await editor.fill(text);
}

export async function submitDraftComposer(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').click();
}

export async function sendSessionMessage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Send message" }).click();
}

export function pathname(page: Page): string {
  return new URL(page.url()).pathname;
}
