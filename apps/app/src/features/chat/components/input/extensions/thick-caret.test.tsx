import { EditorContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ChatInputController } from "../chat-input-controller";
import { createChatBaseExtensions } from "./chat-base-extensions";

const overlay = () => document.querySelector(".chat-input-caret") as HTMLElement | null;

function makeController() {
  return new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });
}

describe("thick caret", () => {
  it("stays visible after typing", async () => {
    const controller = makeController();
    await render(<EditorContent editor={controller.editor} />);
    await page.getByRole("textbox").click();

    await expect.poll(() => overlay()?.hidden).toBe(false);

    controller.editor.commands.insertContent("hello");
    await expect.poll(() => overlay()?.hidden).toBe(false);

    const { view } = controller.editor;
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    controller.editor.commands.insertContent("ni");
    await expect.poll(() => overlay()?.hidden).toBe(false);
    expect(view.dom.style.caretColor).toBe("transparent");

    controller.dispose();
  });
});
