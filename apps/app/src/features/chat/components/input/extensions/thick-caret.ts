import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

// Native caret is 1px; Blink does not expose a width. Overlay a 2px bar on
// the body (composer backdrop-filter would otherwise trap position:fixed) and
// hide the native caret. IME uses the DOM selection (coordsAtPos sits at the
// composition start). `view.hasFocus()` is `activeElement === view.dom`, which
// goes false during IME — track focus on the events and contains().
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
            document.body.append(el);
            let focused = editorHasFocus(view);
            let raf = 0;
            const update = () => {
              cancelAnimationFrame(raf);
              raf = requestAnimationFrame(() => place(view, el, focused));
            };
            const onFocus = () => {
              focused = true;
              update();
            };
            const onBlur = () => {
              if (view.composing) return;
              focused = false;
              update();
            };
            const onCompositionEnd = () => {
              focused = editorHasFocus(view);
              update();
            };
            view.dom.addEventListener("focus", onFocus);
            view.dom.addEventListener("blur", onBlur);
            view.dom.addEventListener("compositionupdate", update);
            view.dom.addEventListener("compositionend", onCompositionEnd);
            window.addEventListener("scroll", update, true);
            update();
            return {
              update,
              destroy() {
                cancelAnimationFrame(raf);
                view.dom.removeEventListener("focus", onFocus);
                view.dom.removeEventListener("blur", onBlur);
                view.dom.removeEventListener("compositionupdate", update);
                view.dom.removeEventListener("compositionend", onCompositionEnd);
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

function editorHasFocus(view: EditorView) {
  const active = view.root.activeElement;
  return active === view.dom || (active != null && view.dom.contains(active));
}

function place(view: EditorView, el: HTMLElement, focused: boolean) {
  if (!(focused || editorHasFocus(view)) || !view.state.selection.empty) {
    el.hidden = true;
    view.dom.style.caretColor = "";
    return;
  }
  const caret = caretRect(view);
  el.hidden = false;
  view.dom.style.caretColor = "transparent";
  el.style.transform = `translate(${Math.round(caret.left)}px, ${Math.round(caret.top)}px)`;
  el.style.height = `${Math.max(1, Math.round(caret.bottom - caret.top))}px`;
}

function caretRect(view: EditorView) {
  const sel = window.getSelection();
  if (sel?.rangeCount && view.dom.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) return rect;
  }
  return view.coordsAtPos(view.state.selection.head);
}
