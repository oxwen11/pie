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

function glyphLineRect(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.classList.contains("chat-input-caret")) continue;
    if (!node.nodeValue?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  }
  return null;
}

describe("thick caret", () => {
  it("is a 1em widget inside the editor, not a body overlay", async () => {
    const controller = makeController();
    await render(
      <EditorContent className="text-sm leading-5 font-medium" editor={controller.editor} />,
    );
    await page.getByRole("textbox").click();

    await expect
      .poll(() => caret() != null && controller.editor.view.dom.contains(caret()))
      .toBe(true);
    await expect.poll(() => caret()?.getBoundingClientRect().height ?? 0).toBeGreaterThan(8);
    await expect.poll(() => caret()?.getBoundingClientRect().height ?? 0).toBeLessThan(18);

    controller.editor.commands.insertContent("Hg");
    await expect
      .poll(() => caret() != null && controller.editor.view.dom.contains(caret()))
      .toBe(true);

    const bar = caret();
    const line = glyphLineRect(controller.editor.view.dom);
    expect(bar).not.toBeNull();
    expect(line).not.toBeNull();
    if (!bar || !line) return;
    const cr = bar.getBoundingClientRect();
    const fs = Number.parseFloat(getComputedStyle(controller.editor.view.dom).fontSize);
    expect(cr.height).toBeGreaterThan(fs - 2);
    expect(cr.height).toBeLessThan(fs + 2);
    expect(cr.top).toBeGreaterThanOrEqual(line.top - 1);
    expect(cr.bottom).toBeLessThanOrEqual(line.bottom + 1);
    expect(Math.abs(cr.top - line.top - (line.bottom - cr.bottom))).toBeLessThan(2);

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
