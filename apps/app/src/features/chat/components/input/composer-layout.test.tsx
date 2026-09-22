import {
  PromptInput,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Card } from "@getpie/ui/components/card";
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

const rectOf = async (testId: string) => {
  const el = (await page.getByTestId(testId).element()) as HTMLElement;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

function Composer({
  controller,
  layout,
  minRows,
}: {
  controller: ChatInputController;
  layout?: "inline";
  minRows?: number;
}) {
  return (
    <Card
      render={
        <PromptInput
          className="divide-y-0"
          data-layout={layout}
          onSubmit={(e) => e.preventDefault()}
        />
      }
    >
      <ChatInputProvider controller={controller}>
        <ChatInput data-testid="ci" minRows={minRows} />
        <PromptInputToolbar data-testid="toolbar">
          <PromptInputTools>
            <span>tool</span>
          </PromptInputTools>
          <PromptInputSubmit />
        </PromptInputToolbar>
      </ChatInputProvider>
    </Card>
  );
}

describe("composer layout", () => {
  it("stacks the toolbar below the input", async () => {
    const controller = makeController();
    const screen = await render(<Composer controller={controller} minRows={2} />);
    const input = await rectOf("ci");
    const toolbar = await rectOf("toolbar");
    await expect(toolbar.y).toBeGreaterThanOrEqual(input.y + input.h - 1);
    await expect(toolbar.x).toBeLessThanOrEqual(input.x + 1);
    await expect(Math.round(input.w)).toBe(Math.round(toolbar.w));
    await screen.unmount();
    controller.dispose();
  });

  it("keeps session controls on the input row", async () => {
    const controller = makeController();
    const screen = await render(<Composer controller={controller} layout="inline" />);
    const input = await rectOf("ci");
    const toolbar = await rectOf("toolbar");
    await expect(toolbar.x).toBeGreaterThanOrEqual(input.x + input.w - 1);
    await expect(Math.abs(input.y + input.h - (toolbar.y + toolbar.h))).toBeLessThanOrEqual(1);
    await screen.unmount();
    controller.dispose();
  });
});
