import { expect } from "vitest";
import { page } from "vitest/browser";

export async function waitForText(text: string | RegExp, timeout = 15_000): Promise<void> {
  await expect.element(page.getByText(text).first(), { timeout }).toBeVisible();
}

export async function waitForComposer(): Promise<void> {
  await expect.element(page.getByRole("textbox").first(), { timeout: 15_000 }).toBeVisible();
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
  await expect
    .element(page.getByPlaceholder("Search folders or enter a full path..."), { timeout: 10_000 })
    .toBeVisible();
}

export async function importFolder(name: string): Promise<void> {
  await page.getByText(name, { exact: true }).click();
  const importButton = page.getByRole("button", { name: "Import this folder" });
  await expect.element(importButton, { timeout: 10_000 }).toBeEnabled();
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
  await expect.element(page.getSubmitButton()).toBeEnabled();
  await page.getSubmitButton().click();
}

export async function sendSessionMessage(): Promise<void> {
  await page.getByRole("button", { name: "Send message" }).click();
}
