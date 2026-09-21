import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

// Native caret is 1px; Blink does not expose a width. Overlay a 2px bar and
// hide the native caret except during IME composition.
export function createThickCaretExtension() {
  return Extension.create({
    name: "chatThickCaret",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("chatThickCaret"),
          view(view) {
            const el = document.createElement("div");
            el.className = "chat-input-caret";
            el.ariaHidden = "true";
            // Body, not the editor: the composer form uses backdrop-filter,
            // which would make position:fixed attach to the form instead of
            // the viewport that coordsAtPos returns.
            document.body.append(el);
            const update = () => place(view, el);
            view.dom.addEventListener("focus", update);
            view.dom.addEventListener("blur", update);
            window.addEventListener("scroll", update, true);
            update();
            return {
              update,
              destroy() {
                view.dom.removeEventListener("focus", update);
                view.dom.removeEventListener("blur", update);
                window.removeEventListener("scroll", update, true);
                view.dom.style.caretColor = "";
                el.remove();
              },
            };
          },
        }),
      ];
    },
  });
}

function place(view: EditorView, el: HTMLElement) {
  if (!view.hasFocus() || !view.state.selection.empty || view.composing) {
    el.hidden = true;
    view.dom.style.caretColor = "";
    return;
  }
  const caret = view.coordsAtPos(view.state.selection.head);
  el.hidden = false;
  view.dom.style.caretColor = "transparent";
  el.style.transform = `translate(${caret.left}px, ${caret.top}px)`;
  el.style.height = `${caret.bottom - caret.top}px`;
}
