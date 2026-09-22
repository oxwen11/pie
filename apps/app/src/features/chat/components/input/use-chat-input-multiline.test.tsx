import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "@/index.css";

import { ChatInput } from "./chat-input";
import { ChatInputController } from "./chat-input-controller";
import { ChatInputProvider } from "./chat-input-provider";
import { createChatBaseExtensions } from "./extensions/chat-base-extensions";
import { useChatInputMultiline } from "./use-chat-input-multiline";

const makeController = () =>
  new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });

function Probe({
  controller,
  width = 480,
}: {
  controller: ChatInputController | null;
  width?: number;
}) {
  const multiline = useChatInputMultiline(controller);
  return (
    <ChatInputProvider controller={controller}>
      <form data-layout="inline" style={{ width }}>
        <ChatInput />
        <div style={{ width: 116, height: 40 }} />
      </form>
      <span>{String(multiline)}</span>
    </ChatInputProvider>
  );
}

describe("useChatInputMultiline", () => {
  it("latches after overflow and only returns after clear", async () => {
    const controller = makeController();
    await render(<Probe controller={controller} />);
    await expect.element(page.getByText("false")).toBeVisible();

    controller.editor.commands.setContent("<p>one</p><p>two</p>");
    await expect.element(page.getByText("true")).toBeVisible();

    controller.editor.commands.setContent("<p>one</p>");
    await expect.element(page.getByText("true")).toBeVisible();

    controller.editor.commands.clearContent();
    await expect.element(page.getByText("false")).toBeVisible();

    controller.dispose();
  });

  it("stacks when soft wrap only appears at the narrower inline width", async () => {
    const controller = makeController();
    const text =
      "第三方都是打发第三方第三方撒东方闪电范德萨发啥的发四等分啥的发四等分阿萨德发啥的发送的发第三方撒发生地方四等分";
    await render(<Probe controller={controller} width={360} />);
    await expect.element(page.getByText("false")).toBeVisible();

    controller.editor.commands.setContent(`<p>${text}</p>`);
    await expect.element(page.getByText("true")).toBeVisible();

    controller.dispose();
  });
});
