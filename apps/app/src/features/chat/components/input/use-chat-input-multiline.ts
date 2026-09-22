import { useCallback, useSyncExternalStore } from "react";

import type { ChatInputController } from "./chat-input-controller";

const latched = new WeakMap<ChatInputController, boolean>();
const noop = () => {
  /* no editor to watch */
};

function overflowsOneLine(dom: Element): boolean {
  const styles = getComputedStyle(dom);
  const line = Number.parseFloat(styles.lineHeight);
  const padY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const oneLine = (Number.isFinite(line) ? line : 20) + (Number.isFinite(padY) ? padY : 0);
  return dom.scrollHeight > oneLine + 1;
}

/** Latch lives on the controller, not React state, so a session swap cannot keep the old layout. */
function syncLatch(controller: ChatInputController): boolean {
  if (controller.editor.isDestroyed || !controller.hasContent()) {
    latched.set(controller, false);
    return false;
  }
  if (latched.get(controller) || overflowsOneLine(controller.editor.view.dom)) {
    latched.set(controller, true);
    return true;
  }
  return false;
}

/** True after the editor overflows one text row at its live width; stays true until empty. */
export function useChatInputMultiline(controller: ChatInputController | null): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!controller || controller.editor.isDestroyed) return noop;
      const measure = () => {
        const prev = latched.get(controller) ?? false;
        if (syncLatch(controller) !== prev) onStoreChange();
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(controller.editor.view.dom);
      const unsub = controller.onChange(measure);
      return () => {
        ro.disconnect();
        unsub();
      };
    },
    [controller],
  );
  const getSnapshot = useCallback(
    () =>
      controller && !controller.editor.isDestroyed ? (latched.get(controller) ?? false) : false,
    [controller],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
