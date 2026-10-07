import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import { ReactRenderer, useCurrentEditor } from "@tiptap/react";
import {
  exitSuggestion,
  Suggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { BoxIcon, FileTextIcon, TerminalIcon } from "lucide-react";
import { Fragment, useEffect, useId } from "react";

import { useLatestRef } from "@/hooks/use-latest-ref";

import {
  allowSlashCommandSuggestion,
  filterSlashCommandItems,
  insertSlashCommand,
  type SlashCommandState,
  type SlashCommandItem,
  slashCommandLabel,
  slashCommandPluginKey,
} from "./slash-command-suggestions";

const SLASH_COMMAND_REFRESH_META = "chatSlashCommandsRefresh";
const commandIcon = {
  extension: TerminalIcon,
  prompt: FileTextIcon,
  skill: BoxIcon,
} as const;
const EDITOR_COMBOBOX_ATTRIBUTES = [
  "role",
  "aria-autocomplete",
  "aria-controls",
  "aria-expanded",
  "aria-haspopup",
  "aria-activedescendant",
  "aria-busy",
] as const;

type SlashCommandPopupProps = {
  state: SlashCommandState;
  items: SlashCommandItem[];
  listboxId: string;
  selectedIndex: number;
  onRetry: () => void;
  onSelect: (item: SlashCommandItem) => void;
};

type ActivePopup = {
  renderer: ReactRenderer<unknown, SlashCommandPopupProps>;
  element: HTMLElement;
  suggestion: SuggestionProps<SlashCommandItem, SlashCommandItem>;
  selectedIndex: number;
  cleanupPosition: () => void;
  cleanupOutsideDismissal: () => void;
  restoreEditorAttributes: () => void;
};

function SlashCommandPopup({
  state,
  items,
  listboxId,
  selectedIndex,
  onRetry,
  onSelect,
}: SlashCommandPopupProps) {
  return (
    <div
      className="bg-popover/95 text-popover-foreground w-full scrollbar-thin overflow-y-auto rounded-2xl border p-2 text-sm backdrop-blur-sm"
      style={{ maxHeight: "var(--slash-command-menu-max-height, 320px)" }}
    >
      {state.status === "loading" ? (
        <div role="status" aria-live="polite" className="text-muted-foreground px-2 py-1.5 text-sm">
          Loading commands…
        </div>
      ) : state.status === "error" ? (
        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span role="alert" className="text-muted-foreground truncate">
            Commands unavailable: {state.message}. Press Enter to retry.
          </span>
          <button
            type="button"
            tabIndex={-1}
            className="text-foreground min-h-11 shrink-0 px-2 underline"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div role="status" aria-live="polite" className="text-muted-foreground px-2 py-1.5 text-sm">
          No matching commands
        </div>
      ) : null}
      <div id={listboxId} role="listbox" aria-label="Commands" className="flex flex-col py-1">
        {state.status === "ready"
          ? items.map((item, index) => {
              const Icon = commandIcon[item.command.source];
              return (
                <Fragment key={item.command.name}>
                  {item.command.source === "skill" &&
                  items[index - 1]?.command.source !== "skill" ? (
                    <div className="bg-popover text-muted-foreground sticky top-0 z-20 w-full shrink-0 p-2 text-sm leading-5">
                      Skills
                    </div>
                  ) : null}
                  <button
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === selectedIndex}
                    data-selected={index === selectedIndex || undefined}
                    className="text-foreground/75 data-[selected]:text-foreground data-[selected]:bg-foreground/5 flex w-full shrink-0 scroll-mt-9 items-center gap-2 overflow-hidden rounded-lg px-2 py-1 text-start text-sm"
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button === 0) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      if (event.button === 0) onSelect(item);
                    }}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="max-w-[60%] shrink-0 truncate">
                        {slashCommandLabel(item.command)}
                      </span>
                      {item.description ? (
                        <span className="text-muted-foreground ms-auto min-w-0 flex-1 truncate">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </Fragment>
              );
            })
          : null}
      </div>
    </div>
  );
}

function preserveEditorAttributes(editorElement: HTMLElement): () => void {
  const previous = new Map(
    EDITOR_COMBOBOX_ATTRIBUTES.map((name) => [name, editorElement.getAttribute(name)]),
  );
  return () => {
    for (const [name, value] of previous) {
      if (value === null) editorElement.removeAttribute(name);
      else editorElement.setAttribute(name, value);
    }
  };
}

function positionPopup(anchor: HTMLElement, popup: HTMLElement): () => void {
  const ownerWindow = anchor.ownerDocument.defaultView;
  if (!ownerWindow) return () => undefined;

  let active = true;
  const update = () => {
    void computePosition(anchor, popup, {
      placement: "top-start",
      strategy: "fixed",
      middleware: [
        offset(8),
        flip({ crossAxis: false, padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight, elements, rects }) {
            elements.floating.style.width = `${rects.reference.width}px`;
            elements.floating.style.setProperty(
              "--slash-command-menu-max-height",
              `${Math.max(80, Math.min(320, availableHeight))}px`,
            );
          },
        }),
      ],
    }).then(({ x, y }) => {
      if (!active) return undefined;
      Object.assign(popup.style, {
        left: `${x}px`,
        top: `${y}px`,
        position: "fixed",
        zIndex: "50",
      });
      return undefined;
    });
  };

  const cleanup = autoUpdate(anchor, popup, update, {
    elementResize: typeof ownerWindow.ResizeObserver === "function",
    layoutShift: typeof ownerWindow.IntersectionObserver === "function",
  });
  return () => {
    active = false;
    cleanup();
  };
}

export type SlashCommandMenuProps = {
  /** Command discovery state prepared by the input's owning surface. */
  state: SlashCommandState;
};

export function SlashCommandMenu({ state }: SlashCommandMenuProps) {
  const { editor } = useCurrentEditor();
  const stateRef = useLatestRef(state);
  const reactId = useId();
  const listboxId = `slash-command-${reactId.replaceAll(":", "")}`;

  useEffect(() => {
    if (!editor || editor.isDestroyed) return () => undefined;

    let popup: ActivePopup | null = null;

    const cleanupPopup = () => {
      const current = popup;
      popup = null;
      if (!current) return;
      current.cleanupOutsideDismissal();
      current.cleanupPosition();
      current.restoreEditorAttributes();
      current.renderer.destroy();
    };

    const renderPopup = (current: ActivePopup) => {
      const currentState = stateRef.current;
      const items = current.suggestion.items;
      const selectedIndex =
        items.length > 0 ? Math.min(Math.max(current.selectedIndex, 0), items.length - 1) : -1;
      current.selectedIndex = selectedIndex;

      const editorElement = editor.view.dom;
      editorElement.setAttribute("role", "combobox");
      editorElement.setAttribute("aria-autocomplete", "list");
      editorElement.setAttribute("aria-controls", listboxId);
      editorElement.setAttribute("aria-expanded", "true");
      editorElement.setAttribute("aria-haspopup", "listbox");
      editorElement.setAttribute("aria-busy", currentState.status === "loading" ? "true" : "false");
      if (selectedIndex >= 0) {
        editorElement.setAttribute("aria-activedescendant", `${listboxId}-option-${selectedIndex}`);
      } else {
        editorElement.removeAttribute("aria-activedescendant");
      }

      current.renderer.updateProps({
        state: currentState,
        items,
        listboxId,
        selectedIndex,
        onRetry: () => {
          if (stateRef.current.status === "error") stateRef.current.retry();
        },
        onSelect: (item: SlashCommandItem) => current.suggestion.command(item),
      });

      if (selectedIndex >= 0) {
        queueMicrotask(() => {
          if (popup !== current) return;
          editorElement.ownerDocument
            .getElementById(`${listboxId}-option-${selectedIndex}`)
            ?.scrollIntoView?.({ block: "nearest" });
        });
      }
    };

    const updatePopup = (
      suggestion: SuggestionProps<SlashCommandItem, SlashCommandItem>,
      resetSelection: boolean,
    ) => {
      const current = popup;
      if (!current) return;
      const selectedName = current.suggestion.items[current.selectedIndex]?.command.name;
      current.suggestion = suggestion;
      if (resetSelection) {
        current.selectedIndex = 0;
      } else if (selectedName) {
        const preservedIndex = suggestion.items.findIndex(
          (item) => item.command.name === selectedName,
        );
        current.selectedIndex = Math.max(preservedIndex, 0);
      } else {
        current.selectedIndex = 0;
      }
      renderPopup(current);
    };

    const moveSelection = (nextIndex: number) => {
      const current = popup;
      if (!current || current.suggestion.items.length === 0) return;
      current.selectedIndex = nextIndex;
      renderPopup(current);
    };

    const handleKeyDown = ({ event }: SuggestionKeyDownProps): boolean => {
      const current = popup;
      if (!current || event.isComposing) return false;
      if (
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        (event.shiftKey && event.key !== "Tab")
      ) {
        return false;
      }

      const { items } = current.suggestion;
      switch (event.key) {
        case "ArrowUp":
          if (items.length === 0) return false;
          moveSelection((current.selectedIndex - 1 + items.length) % items.length);
          return true;
        case "ArrowDown":
          if (items.length === 0) return false;
          moveSelection((current.selectedIndex + 1) % items.length);
          return true;
        case "Tab":
          exitSuggestion(editor.view, slashCommandPluginKey);
          return false;
        case "Home":
          if (items.length === 0) return false;
          moveSelection(0);
          return true;
        case "End":
          if (items.length === 0) return false;
          moveSelection(items.length - 1);
          return true;
        case "Enter": {
          const currentState = stateRef.current;
          if (currentState.status === "error") {
            currentState.retry();
            return true;
          }
          const item = items[current.selectedIndex];
          if (!item) return false;
          current.suggestion.command(item);
          return true;
        }
        default:
          return false;
      }
    };

    const plugin = Suggestion<SlashCommandItem, SlashCommandItem>({
      editor,
      pluginKey: slashCommandPluginKey,
      char: "/",
      startOfLine: true,
      allow: allowSlashCommandSuggestion,
      shouldResetDismissed: ({ transaction }) =>
        transaction.getMeta(SLASH_COMMAND_REFRESH_META) === true,
      items: ({ query }) => {
        const currentState = stateRef.current;
        return currentState.status === "ready"
          ? filterSlashCommandItems(currentState.items, query)
          : [];
      },
      command: ({ editor: commandEditor, range, props }) =>
        insertSlashCommand(commandEditor, range, props),
      render: () => ({
        onStart: (suggestion) => {
          cleanupPopup();
          const editorElement = editor.view.dom;
          const ownerWindow = editorElement.ownerDocument.defaultView;
          const anchor = editorElement.closest("form");
          if (!ownerWindow || !(anchor instanceof ownerWindow.HTMLElement)) return;

          const renderer = new ReactRenderer<unknown, SlashCommandPopupProps>(SlashCommandPopup, {
            editor,
            props: {
              state: stateRef.current,
              items: suggestion.items,
              listboxId,
              selectedIndex: suggestion.items.length > 0 ? 0 : -1,
              onRetry: () => {
                if (stateRef.current.status === "error") stateRef.current.retry();
              },
              onSelect: (item: SlashCommandItem) => suggestion.command(item),
            },
          });
          const { element } = renderer;
          editorElement.ownerDocument.body.append(element);
          const restoreEditorAttributes = preserveEditorAttributes(editorElement);
          const cleanupPosition = positionPopup(anchor, element);
          const dismissOutside = (event: Event) => {
            const target = event.target;
            if (
              target instanceof ownerWindow.Node &&
              !element.contains(target) &&
              !editorElement.contains(target)
            ) {
              exitSuggestion(editor.view, slashCommandPluginKey);
            }
          };
          editorElement.ownerDocument.addEventListener("pointerdown", dismissOutside, true);

          popup = {
            renderer,
            element,
            suggestion,
            selectedIndex: 0,
            cleanupPosition,
            cleanupOutsideDismissal: () =>
              editorElement.ownerDocument.removeEventListener("pointerdown", dismissOutside, true),
            restoreEditorAttributes,
          };
          renderPopup(popup);
        },
        onUpdate: (suggestion) =>
          updatePopup(suggestion, popup?.suggestion.query !== suggestion.query),
        onExit: cleanupPopup,
        onKeyDown: handleKeyDown,
      }),
    });

    const existingPlugin = editor.state.plugins.find(
      (candidate) => candidate.spec.key === slashCommandPluginKey,
    );
    if (existingPlugin) editor.unregisterPlugin(slashCommandPluginKey);
    editor.registerPlugin(plugin, (newPlugin, plugins) => [newPlugin, ...plugins]);

    return () => {
      cleanupPopup();
      if (!editor.isDestroyed) editor.unregisterPlugin(slashCommandPluginKey);
    };
  }, [stateRef, editor, listboxId]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return () => undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(slashCommandPluginKey, { exit: true }));
      editor.view.dispatch(editor.state.tr.setMeta(SLASH_COMMAND_REFRESH_META, true));
    });
    return () => {
      cancelled = true;
    };
  }, [state, editor]);

  return null;
}
