import { EditorContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";

import { ChatInputController } from "../chat-input-controller";
import { createChatBaseExtensions } from "./chat-base-extensions";

const caret = () => document.querySelector(".chat-input-caret") as HTMLElement | null;

function makeController() {
  return new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });
}

describe("thick caret", () => {
  it("is a 1em widget inside the editor, not a body overlay", async () => {
    const controller = makeController();
    await render(<EditorContent editor={controller.editor} />);
    await page.getByRole("textbox").click();

    await expect
      .poll(() => caret() != null && controller.editor.view.dom.contains(caret()))
      .toBe(true);
    await expect.poll(() => caret()?.getBoundingClientRect().height ?? 0).toBeGreaterThan(8);
    await expect.poll(() => caret()?.getBoundingClientRect().height ?? 0).toBeLessThan(18);

    controller.editor.commands.insertContent("hello");
    await expect
      .poll(() => caret() != null && controller.editor.view.dom.contains(caret()))
      .toBe(true);

    const { view } = controller.editor;
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await expect
      .poll(() => {
        const el = caret();
        return el ? getComputedStyle(el).visibility : "";
      })
      .toBe("hidden");
    expect(getComputedStyle(view.dom).caretColor).not.toBe("rgba(0, 0, 0, 0)");

    controller.dispose();
  });
});
