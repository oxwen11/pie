import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";

// Composable keymap: one behavior per extension. Future Tab/Shift+Tab/cmdEnter
// behaviors are added as new extensions — this one doesn't change.
export function createSubmitKeymap(opts: { onSubmit: () => void }) {
  return Extension.create({
    name: "chatSubmitKeymap",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("chatSubmitKeymap"),
          props: {
            handleKeyDown(_view, event) {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey
              ) {
                return false;
              }
              // Enter during IME composition confirms the candidate — not a send.
              if (event.isComposing) return false;
              // Suggestion navigation runs in the DOM capture phase and marks a
              // selected Enter as handled before ProseMirror receives it.
              if (event.defaultPrevented) return true;
              event.preventDefault();
              opts.onSubmit();
              return true;
            },
          },
        }),
      ];
    },
  });
}
