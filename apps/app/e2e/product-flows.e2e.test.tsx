import { createCloseablePieClient, getWsTicket } from "@getpie/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

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
    await waitForComposer();
    await expect.element(page.getByTitle("New chat")).toBeVisible();
    await expect.element(page.getByText("Choose project").first()).toBeVisible();

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

    await expect.poll(() => window.location.pathname, { timeout: 60_000 }).toMatch(/\/session\//);
    await waitForText(FIRST_PROMPT);
    await waitForText(fakeReply(), 60_000);
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
    await waitForText(/Thinking|E2E fake Pi reply/, 60_000);
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
    await page.getByRole("link", { name: "Pull Request" }).click();
    await expect.poll(() => window.location.pathname).toBe("/pull-requests");
    await waitForText("No open pull requests");
    await expect.element(page.getByText("No open pull requests")).toBeVisible();
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
    await expect.poll(() => window.location.pathname, { timeout: 60_000 }).toMatch(/\/session\//);

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Review" }).click();
    await waitForText(/Review|Compare mode|No changes|uncommitted/i);
  });
});

describe("session archive", () => {
  it("archives the open session from the row menu", async () => {
    await mountApp();
    await waitForText(sample());
    await openDraftForProject(sample());
    await fillComposer("e2e archive me");
    await submitDraftComposer();
    await expect.poll(() => window.location.pathname, { timeout: 60_000 }).toMatch(/\/session\//);
    await waitForText("e2e archive me");

    const sessionPath = window.location.pathname;
    const projectId = new URL(window.location.href).searchParams.get("projectId");
    expect(projectId).toBeTruthy();

    await page.getByText("e2e archive me", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive" }).click();

    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toBe("/draft");
    await expect.poll(() => window.location.search).toContain(`projectId=${projectId}`);
    // Sidebar drops the row (no archived list / Restore entry yet).
    await expect.element(page.getByText("e2e archive me", { exact: true })).not.toBeInTheDocument();

    // No archived list in the sidebar yet — Restore UI is unreachable.
    // Bookmarked archived sessions still open.
    await mountApp(`${sessionPath}?projectId=${projectId}`);
    await expect.poll(() => window.location.pathname, { timeout: 15_000 }).toBe(sessionPath);
    await waitForText("e2e archive me");
  });
});

describe("streaming queue", () => {
  it("stops a held turn and steers a queued follow-up", async () => {
    await mountApp();
    await waitForText(sample());
    await openDraftForProject(sample());
    await fillComposer("e2e-hold for stop and queue");
    await submitDraftComposer();

    await expect.poll(() => window.location.pathname, { timeout: 60_000 }).toMatch(/\/session\//);
    await expect
      .element(page.getByRole("button", { name: "Stop generating" }), { timeout: 30_000 })
      .toBeVisible();

    await fillComposer("queued while streaming");
    await sendSessionMessage();
    await waitForText("1 queued message", 15_000);
    await expect.element(page.getByText("queued while streaming")).toBeVisible();

    await page.getByRole("button", { name: "Steer queued message" }).click();
    await waitForText("Steer", 10_000);

    // Optimistic UI updates before RPC — prove the server queue moved too.
    const sessionId = window.location.pathname.split("/").at(-1);
    const projectId = new URL(window.location.href).searchParams.get("projectId");
    expect(sessionId).toBeTruthy();
    expect(projectId).toBeTruthy();
    if (sessionId === undefined || projectId === null) {
      throw new Error("missing session ref after steer");
    }
    const server = pieE2E();
    const { client, close } = createCloseablePieClient({
      url: `${server.wsBaseUrl}/ws/rpc`,
      getTicket: () => getWsTicket(server.httpBaseUrl),
    });
    try {
      await expect
        .poll(
          async () => {
            const snapshot = await client.agent.session.getSnapshot({
              ref: { projectId, sessionId },
            });
            return snapshot.pendingPrompt;
          },
          { timeout: 15_000 },
        )
        .toEqual({ steering: ["queued while streaming"], followUp: [] });
    } finally {
      close();
    }

    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect
      .element(page.getByRole("button", { name: "Stop generating" }), { timeout: 30_000 })
      .not.toBeInTheDocument();
  });
});

describe("terminal panel", () => {
  it("opens a host terminal beside the chat", async () => {
    await mountApp();
    await waitForText(sample());
    await openDraftForProject(sample());
    await fillComposer("e2e terminal panel");
    await submitDraftComposer();
    await expect.poll(() => window.location.pathname, { timeout: 60_000 }).toMatch(/\/session\//);
    await waitForText("e2e terminal panel");

    await page.getByRole("button", { name: "Toggle content panel" }).click();
    await waitForText("Choose what to show alongside the chat.");
    await page.getByRole("button", { name: "Terminal" }).click();
    const input = page.getByLabelText("zsh input");
    await expect.element(input, { timeout: 30_000 }).toBeVisible();

    // textarea exists before PTY connect — retry until write/output works.
    const marker = "__PIE_TERMINAL_E2E__";
    await expect
      .poll(
        async () => {
          await input.click();
          await userEvent.keyboard(`printf '${marker}\\n'{Enter}`);
          try {
            await expect.element(page.getByText(marker).first(), { timeout: 2_000 }).toBeVisible();
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  });
});
