import type { Extensions } from "@tiptap/react";

import type { ChatInputController } from "../chat-input-controller";
import { createChatBaseExtensions } from "./chat-base-extensions";
import { createSubmitKeymap } from "./keymaps";

/**
 * Shared composer extensions. Base schema first, submit keymap last — otherwise
 * bare Enter is consumed by the default newline behavior before the keymap
 * sees it.
 */
export function createChatComposerExtensions(
  controller: ChatInputController,
  placeholder?: string,
): Extensions {
  return [
    ...createChatBaseExtensions(
      placeholder === undefined ? {} : { placeholder: () => placeholder },
    ),
    createSubmitKeymap({ onSubmit: () => void controller.submit() }),
  ];
}
