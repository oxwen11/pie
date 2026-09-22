import type { JSONContent } from "@tiptap/react";

import { ChatInputController, type ChatInputControllerOptions } from "./chat-input-controller";
import { createChatComposerExtensions } from "./extensions/chat-composer-extensions";
import { useChatInputController } from "./use-chat-input-controller";

type ChatComposerControllerOptions = Omit<ChatInputControllerOptions, "extensions"> & {
  onDispose?: (doc: JSONContent | undefined) => void;
  placeholder?: string;
};

/** Session and draft composers share extension order; each supplies its own submit. */
export function useChatComposerController(
  opts: ChatComposerControllerOptions,
): ChatInputController | null {
  const { onDispose, placeholder, ...controller } = opts;
  return useChatInputController({
    ...controller,
    onDispose,
    extensions: (self) => createChatComposerExtensions(self, placeholder),
  });
}
