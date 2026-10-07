import { PromptInputButton, PromptInputSubmit } from "@getpie/ui/ai-elements/prompt-input";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";

import { ChatComposerFrame } from "./chat-composer-frame";
import { ChatInputController } from "./input/chat-input-controller";
import { createChatBaseExtensions } from "./input/extensions/chat-base-extensions";

describe("ChatComposerFrame", () => {
  it.each([undefined, "inline"] as const)(
    "focuses from the whole input surface without intercepting controls (%s)",
    async (layout) => {
      const controller = new ChatInputController({
        extensions: () => createChatBaseExtensions(),
        onSubmit: () => {},
      });
      const focus = vi.spyOn(controller, "focus");
      const action = vi.fn<() => void>();
      const screen = await render(
        <ChatComposerFrame
          controller={controller}
          layout={layout}
          minRows={2}
          submit={<PromptInputSubmit disabled />}
          toolbar={
            <>
              <span data-testid="toolbar-space">space</span>
              <PromptInputButton aria-label="Composer action" onClick={action}>
                <span data-testid="action-icon">icon</span>
              </PromptInputButton>
            </>
          }
        />,
      );
      try {
        const editor = controller.editor.view.dom;
        const input = editor.closest('[data-slot="chat-input"]');
        const form = editor.closest("form");
        if (!input || !form) throw new Error("Composer input surface is missing");

        for (const surface of [input, form]) {
          controller.editor.commands.blur();
          focus.mockClear();
          await page.elementLocator(surface).click({
            position: {
              x: surface.clientWidth / 2,
              y: surface.clientHeight - 3,
            },
          });
          expect(focus).toHaveBeenCalledOnce();
          await expect.poll(() => document.activeElement).toBe(editor);
        }

        controller.editor.commands.blur();
        focus.mockClear();
        await page.getByTestId("toolbar-space").click();
        expect(focus).toHaveBeenCalledOnce();
        await expect.poll(() => document.activeElement).toBe(editor);

        focus.mockClear();
        await page.getByTestId("action-icon").click();
        expect(action).toHaveBeenCalledOnce();
        expect(focus).not.toHaveBeenCalled();
        await expect.element(page.getByRole("button", { name: "Composer action" })).toHaveFocus();

        await page.elementLocator(editor).click();
        expect(focus).not.toHaveBeenCalled();
        await expect.poll(() => document.activeElement).toBe(editor);
      } finally {
        await screen.unmount();
        controller.dispose();
      }
    },
  );
});
