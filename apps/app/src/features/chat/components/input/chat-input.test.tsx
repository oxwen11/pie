import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";

import { ChatInput } from "./chat-input";
import { ChatInputController } from "./chat-input-controller";
import { ChatInputProvider } from "./chat-input-provider";
import { createChatBaseExtensions } from "./extensions/chat-base-extensions";

const makeController = () =>
  new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });

const px = async (testId: string) => {
  const el = (await page.getByTestId(testId).element()) as HTMLElement;
  return Math.round(el.getBoundingClientRect().height);
};

describe("ChatInput", () => {
  it("defaults to one text row and grows with minRows", async () => {
    const one = makeController();
    const screen = await render(
      <ChatInputProvider controller={one}>
        <ChatInput data-testid="one-row" />
      </ChatInputProvider>,
    );
    await expect(px("one-row")).resolves.toBe(32);

    const two = makeController();
    await screen.rerender(
      <ChatInputProvider controller={two}>
        <ChatInput data-testid="two-rows" minRows={2} />
      </ChatInputProvider>,
    );
    await expect.element(page.getByTestId("two-rows")).toBeVisible();
    await expect(px("two-rows")).resolves.toBe(52);

    await screen.unmount();
    one.dispose();
    two.dispose();
  });

  it("keeps minRows winning over a min-h class from className", async () => {
    const controller = makeController();
    const screen = await render(
      <ChatInputProvider controller={controller}>
        <ChatInput className="min-h-96" data-testid="override" minRows={2} />
      </ChatInputProvider>,
    );
    await expect(px("override")).resolves.toBe(52);

    await screen.unmount();
    controller.dispose();
  });
});
