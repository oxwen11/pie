import type { JSONContent } from "@tiptap/react";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { useLatestRef } from "@/hooks/use-latest-ref";

import { ChatInputController, type ChatInputControllerOptions } from "./chat-input-controller";

const getServerSnapshot = (): ChatInputController | null => null;

export type UseChatInputControllerOptions = ChatInputControllerOptions & {
  /** Called with the editor JSON right before dispose — capture at subscribe. */
  onDispose?: (doc: JSONContent | undefined) => void;
};

// The controller is a store this hook owns: subscribe constructs it, the
// unsubscribe disposes it. StrictMode subscribe/unsubscribe/subscribe creates
// and destroys a throwaway instance — a destroyed editor is never reused.
// Callbacks go through a latest-ref so closures never see stale state. First
// render returns null — consumers must tolerate it.
//
// Remount (e.g. `key={sessionRefKey}`) to switch sessions. `onDispose` /
// `initialContent` are snapshotted when subscribe runs, not read from the
// latest-ref on unsubscribe: a parent re-render can update opts before the
// outgoing subscription tears down, and a latest-ref would save the outgoing
// draft onto the incoming chat.
export function useChatInputController(
  opts: UseChatInputControllerOptions,
): ChatInputController | null {
  const optsRef = useLatestRef(opts);
  const storeRef = useRef<ChatInputController | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const { initialContent, onDispose } = optsRef.current;
      const created = new ChatInputController({
        extensions: (self) => optsRef.current.extensions(self),
        onSubmit: (text) => optsRef.current.onSubmit(text),
        initialContent,
      });
      storeRef.current = created;
      onStoreChange();
      return () => {
        onDispose?.(created.getJSON());
        storeRef.current = null;
        created.dispose();
        onStoreChange();
      };
    },
    [optsRef],
  );

  const getSnapshot = useCallback(() => storeRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
