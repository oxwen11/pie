import { composer, expect, FAKE_REPLY, sendButton, test } from "./fixtures.js";

const SESSION_URL = /\/session\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test("/ redirects to /draft", async ({ page, pie }) => {
  await page.goto(`${pie.baseUrl}/`);
  await page.waitForURL(/\/draft/);
});

test("draft composer sends a prompt to a session against fake-pi", async ({ page, pie }) => {
  const prompt = "hello from web e2e";

  await page.goto(`${pie.baseUrl}/draft?projectId=${pie.projectId}`);
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  await expect(sendButton(page)).toBeDisabled();
  await expect(page.getByText("e2e-workspace").first()).toBeVisible();

  const model = page.getByRole("combobox");
  if ((await model.count()) > 0) {
    await expect(model.first()).toBeVisible();
  }

  await composer(page).click();
  await composer(page).pressSequentially(prompt);
  await expect(sendButton(page)).toBeEnabled();

  // Enter is a newline / CDP Enter does not submit — click send.
  await sendButton(page).click();
  await page.waitForURL(SESSION_URL, { timeout: 20_000 });

  await expect(page.getByText(prompt).first()).toBeVisible();
  await expect(page.getByText(FAKE_REPLY).first()).toBeVisible({ timeout: 15_000 });
  // Sidebar session list is the Query cache / agent.session.list surface.
  await expect(page.getByRole("button", { name: prompt, exact: true })).toBeVisible();
});
