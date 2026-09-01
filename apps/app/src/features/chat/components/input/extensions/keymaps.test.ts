// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { ChatInputController } from "../chat-input-controller";
import { createChatBaseExtensions } from "./chat-base-extensions";
import { createSubmitKeymap } from "./keymaps";

const makeController = (onSubmit: () => void) =>
  new ChatInputController({
    extensions: () => [...createChatBaseExtensions(), createSubmitKeymap({ onSubmit })],
    onSubmit: () => {},
  });

const pressEnter = (controller: ChatInputController) => {
  controller.editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
};

describe("createSubmitKeymap", () => {
  it("submits on an unmodified Enter", () => {
    const onSubmit = vi.fn<() => void>();
    const controller = makeController(onSubmit);

    pressEnter(controller);

    expect(onSubmit).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("does not also submit an Enter consumed by suggestion navigation", () => {
    const onSubmit = vi.fn<() => void>();
    const controller = makeController(onSubmit);
    controller.editor.view.dom.addEventListener("keydown", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });

    pressEnter(controller);

    expect(onSubmit).not.toHaveBeenCalled();
    controller.dispose();
  });
});
