// Tiptap builds its document through `elementFromString`, so these need a DOM.
import { describe, expect, it, vi } from "vitest";

import { ChatInputController } from "./chat-input-controller";
import { createChatBaseExtensions } from "./extensions/chat-base-extensions";

const makeController = () =>
  new ChatInputController({
    extensions: () => createChatBaseExtensions(),
    onSubmit: () => {},
  });

describe("ChatInputController", () => {
  it("calls onEmptySubmit instead of onSubmit when there is nothing to send", async () => {
    const onSubmit = vi.fn<(text: string) => void>();
    const onEmptySubmit = vi.fn<() => void>();
    const controller = new ChatInputController({
      extensions: () => createChatBaseExtensions(),
      onSubmit,
      onEmptySubmit,
    });

    await controller.submit();
    controller.editor.commands.setContent("<p>   </p>");
    await controller.submit();

    expect(onEmptySubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();

    controller.editor.commands.setContent("<p>hi</p>");
    await controller.submit();
    expect(onSubmit).toHaveBeenCalledWith("hi");
    expect(onEmptySubmit).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("reports content on the same threshold submit() uses", () => {
    const controller = makeController();

    expect(controller.hasContent()).toBe(false);

    controller.editor.commands.setContent("<p>   </p>");
    expect(controller.hasContent()).toBe(false);

    controller.editor.commands.setContent("<p>hi</p>");
    expect(controller.hasContent()).toBe(true);
    expect(controller.getText()).toBe("hi");

    controller.dispose();
  });

  it("notifies subscribers on edits and stops on unsubscribe", () => {
    const controller = makeController();
    const listener = vi.fn<() => void>();
    const unsubscribe = controller.onChange(listener);

    controller.editor.commands.setContent("<p>hi</p>");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    controller.editor.commands.setContent("<p>bye</p>");
    expect(listener).not.toHaveBeenCalled();

    controller.dispose();
  });

  // The state React hands the committed `useSyncExternalStore` snapshot when a
  // route match suspends: the controller store's unsubscribe has already disposed
  // this instance, but the last committed render still closes over it. Reading
  // the destroyed editor is what threw `Cannot read properties of null
  // (reading 'extensions')` — `Editor.destroy()` nulls `extensionManager`, and
  // serialization walks it first.
  it("answers false instead of throwing once disposed", () => {
    const controller = makeController();
    controller.editor.commands.setContent("<p>hi</p>");
    expect(controller.hasContent()).toBe(true);

    controller.dispose();

    expect(() => controller.hasContent()).not.toThrow();
    expect(controller.hasContent()).toBe(false);
    expect(controller.getJSON()).toBeUndefined();
  });

  it("seeds from initialContent and exposes getJSON", () => {
    const initialContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "saved draft" }] }],
    };
    const controller = new ChatInputController({
      extensions: () => createChatBaseExtensions(),
      onSubmit: () => {},
      initialContent,
    });

    expect(controller.getText()).toBe("saved draft");
    expect(controller.getJSON()).toEqual(initialContent);

    controller.dispose();
  });
});
