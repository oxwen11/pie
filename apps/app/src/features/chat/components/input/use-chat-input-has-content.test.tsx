import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ChatInputController } from "./chat-input-controller";
import { createChatBaseExtensions } from "./extensions/chat-base-extensions";
import { useChatInputHasContent } from "./use-chat-input-has-content";

const makeController = (html?: string) => {
  const controller = new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });
  if (html) controller.editor.commands.setContent(html);
  return controller;
};

function Probe({ controller }: { controller: ChatInputController | null }) {
  return <span>{String(useChatInputHasContent(controller))}</span>;
}

describe("useChatInputHasContent", () => {
  it("starts false while the controller is still being created", async () => {
    await render(<Probe controller={null} />);
    await expect.element(page.getByText("false")).toBeVisible();
  });

  it("tracks edits on the mounted controller", async () => {
    const controller = makeController();
    await render(<Probe controller={controller} />);
    await expect.element(page.getByText("false")).toBeVisible();

    controller.editor.commands.setContent("<p>hi</p>");
    await expect.element(page.getByText("true")).toBeVisible();

    controller.editor.commands.clearContent();
    await expect.element(page.getByText("false")).toBeVisible();

    controller.dispose();
  });

  // The session-switch window: React tears the controller effect down and back
  // up while this component stays mounted (a route match suspending on its
  // loader, StrictMode, <Activity>), so one editor is destroyed and another
  // built between two renders of the same fiber. Both halves have to hold —
  // rendering the outgoing, already-disposed controller must not throw, and the
  // incoming one must be read immediately rather than waiting for its first
  // transaction. `useEditorState` failed both: its cached snapshot still
  // pointed at the destroyed editor.
  it("survives the disposed outgoing controller and reads the incoming one at once", async () => {
    const outgoing = makeController("<p>typed before switching</p>");
    const screen = await render(<Probe controller={outgoing} />);
    await expect.element(page.getByText("true")).toBeVisible();

    outgoing.dispose();
    await expect(screen.rerender(<Probe controller={outgoing} />)).resolves.toBeUndefined();
    await expect.element(page.getByText("false")).toBeVisible();

    const incoming = makeController("<p>restored draft</p>");
    await screen.rerender(<Probe controller={incoming} />);
    await expect.element(page.getByText("true")).toBeVisible();

    incoming.dispose();
  });
});
