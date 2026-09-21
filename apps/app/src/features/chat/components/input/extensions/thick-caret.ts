import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

// 2px caret as a widget decoration (TipTap/ProseMirror), not a measured overlay.
// ZWSP so the inline-block shares the text baseline; CSS line-height 1 = 1em.
// Native caret during IME (`data-composing`).
export function createThickCaretExtension() {
  return Extension.create({
    name: "chatThickCaret",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("chatThickCaret"),
          props: {
            decorations(state) {
              const { selection } = state;
              if (!selection.empty) return null;
              return DecorationSet.create(state.doc, [
                Decoration.widget(selection.head, caretEl, { key: "caret", side: 1 }),
              ]);
            },
          },
          view(view) {
            view.dom.classList.add("chat-thick-caret");
            const onStart = () => {
              view.dom.dataset.composing = "";
            };
            const onEnd = () => {
              delete view.dom.dataset.composing;
            };
            view.dom.addEventListener("compositionstart", onStart);
            view.dom.addEventListener("compositionend", onEnd);
            return {
              destroy() {
                view.dom.removeEventListener("compositionstart", onStart);
                view.dom.removeEventListener("compositionend", onEnd);
                view.dom.classList.remove("chat-thick-caret");
                delete view.dom.dataset.composing;
              },
            };
          },
        }),
      ];
    },
  });
}

function caretEl() {
  const el = document.createElement("span");
  el.className = "chat-input-caret";
  el.ariaHidden = "true";
  el.textContent = "\u200b";
  return el;
}
