// @vitest-environment jsdom
import type { AgentCommand } from "@getpie/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "./chat-input";
import { ChatInputController } from "./chat-input-controller";
import { ChatInputProvider } from "./chat-input-provider";
import { createChatBaseExtensions } from "./extensions/chat-base-extensions";
import { createSubmitKeymap } from "./extensions/keymaps";
import { SlashCommandMenu } from "./slash-command-menu";
import {
  allowSlashCommandSuggestion,
  createSlashCommandSuggestionItems,
  insertSlashCommand,
  type SlashCommandState,
} from "./slash-command-suggestions";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const commands: AgentCommand[] = [
  { name: "explain", description: "Explain the selected code", source: "prompt" },
  { name: "skill:review", description: "Review the current changes", source: "skill" },
];

const readyState = (source = commands): SlashCommandState => ({
  status: "ready",
  items: createSlashCommandSuggestionItems(source),
});

type Harness = {
  controller: ChatInputController;
  root: Root;
  host: HTMLElement;
  onSubmit: ReturnType<typeof vi.fn<() => void>>;
  render: (state: SlashCommandState) => Promise<void>;
  dispose: () => Promise<void>;
};

async function createHarness(initialState: SlashCommandState): Promise<Harness> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const onSubmit = vi.fn<() => void>();
  const controller = new ChatInputController({
    extensions: () => [...createChatBaseExtensions(), createSubmitKeymap({ onSubmit })],
    onSubmit: () => {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async (state: SlashCommandState) => {
    await act(async () => {
      root.render(
        <form>
          <ChatInputProvider controller={controller}>
            <ChatInput />
            <SlashCommandMenu state={state} />
          </ChatInputProvider>
        </form>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await render(initialState);

  return {
    controller,
    root,
    host,
    onSubmit,
    render,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
      controller.dispose();
    },
  };
}

async function openSlash(harness: Harness, text = "/") {
  await act(async () => {
    harness.controller.editor.commands.setContent(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function dispatchKey(harness: Harness, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.isComposing) Object.defineProperty(event, "isComposing", { value: true });
  await act(async () => {
    harness.controller.editor.view.dom.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return event;
}

describe("slash command suggestions", () => {
  it("only activates for a slash at the beginning of the complete prompt", () => {
    expect(allowSlashCommandSuggestion({ range: { from: 1, to: 2 } })).toBe(true);
    expect(allowSlashCommandSuggestion({ range: { from: 8, to: 9 } })).toBe(false);
  });

  it("shows loading and refreshes when command data arrives after slash", async () => {
    const harness = await createHarness({ status: "loading" });
    try {
      await openSlash(harness);
      const loadingStatus = document.querySelector('[role="status"]');
      expect(loadingStatus?.textContent).toContain("Loading commands");
      expect(loadingStatus?.closest('[role="listbox"]')).toBeNull();
      expect(document.querySelector('[role="listbox"]')?.childElementCount).toBe(0);

      await harness.render(readyState());
      expect(document.body.textContent).toContain("/explain");
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    } finally {
      await harness.dispose();
    }
  });

  it("shows discovery errors and exposes keyboard and pointer retry", async () => {
    const retry = vi.fn<() => void>();
    const harness = await createHarness({ status: "error", message: "offline", retry });
    try {
      await openSlash(harness);
      const alert = document.querySelector('[role="alert"]');
      const retryButton = document.querySelector<HTMLButtonElement>("button");
      expect(alert?.textContent).toContain("offline");
      expect(alert?.textContent).toContain("Press Enter to retry");
      expect(alert?.closest('[role="listbox"]')).toBeNull();
      expect(retryButton?.closest('[role="listbox"]')).toBeNull();
      expect(retryButton?.tabIndex).toBe(-1);
      expect(retryButton?.className).toContain("min-h-11");

      const enter = await dispatchKey(harness, { key: "Enter" });
      expect(enter.defaultPrevented).toBe(true);
      expect(retry).toHaveBeenCalledOnce();

      await act(async () => retryButton?.click());
      expect(retry).toHaveBeenCalledTimes(2);
    } finally {
      await harness.dispose();
    }
  });

  it("exits suggestion state when outside dismissal hides the menu", async () => {
    const harness = await createHarness(readyState());
    try {
      await openSlash(harness);
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      await act(async () => {
        document.body.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector('[role="listbox"]')).toBeNull();

      await dispatchKey(harness, { key: "Enter" });
      expect(harness.controller.editor.getHTML()).toBe("<p>/</p>");
      expect(harness.onSubmit).toHaveBeenCalledOnce();
    } finally {
      await harness.dispose();
    }
  });

  it("resets stale keyboard selection when the command collection changes", async () => {
    const harness = await createHarness(readyState());
    try {
      await openSlash(harness);
      await dispatchKey(harness, { key: "ArrowDown" });
      expect(
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent,
      ).toContain("/skill:review");

      await harness.render(readyState([commands[0]!]));
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
      expect(document.querySelector('[role="option"]')?.textContent).toContain("/explain");
      await dispatchKey(harness, { key: "Enter" });
      expect(harness.controller.editor.getHTML()).toBe("<p>/explain </p>");
      expect(harness.onSubmit).not.toHaveBeenCalled();
    } finally {
      await harness.dispose();
    }
  });

  it("keeps modified and composing Enter out of command selection", async () => {
    const harness = await createHarness(readyState());
    try {
      const closedMenuAltEnter = await dispatchKey(harness, { key: "Enter", altKey: true });
      expect(closedMenuAltEnter.defaultPrevented).toBe(false);

      await openSlash(harness);
      const openMenuAltEnter = await dispatchKey(harness, { key: "Enter", altKey: true });
      expect(openMenuAltEnter.defaultPrevented).toBe(false);
      expect(harness.controller.editor.getHTML()).toBe("<p>/</p>");

      await dispatchKey(harness, { key: "Enter", isComposing: true });
      expect(harness.controller.editor.getText()).not.toContain("/explain");
      expect(harness.onSubmit).not.toHaveBeenCalled();

      await openSlash(harness);
      await dispatchKey(harness, { key: "Enter", shiftKey: true });
      expect(harness.controller.editor.getHTML()).toBe("<p>/<br></p>");

      await openSlash(harness);
      await dispatchKey(harness, { key: "Enter", ctrlKey: true });
      expect(harness.controller.editor.getHTML()).toBe("<p>/<br></p>");
    } finally {
      await harness.dispose();
    }
  });

  it("supports the complete keyboard map and exposes listbox semantics", async () => {
    const harness = await createHarness(readyState());
    try {
      await openSlash(harness);
      const editorElement = harness.controller.editor.view.dom;
      const listbox = document.querySelector('[role="listbox"]');
      expect(editorElement.getAttribute("role")).toBe("combobox");
      expect(editorElement.getAttribute("aria-label")).toBe("Message");
      expect(editorElement.getAttribute("aria-expanded")).toBe("true");
      expect(editorElement.getAttribute("aria-controls")).toBe(listbox?.id);
      const options = document.querySelectorAll<HTMLElement>('[role="option"][aria-selected]');
      expect(options).toHaveLength(2);
      expect(Array.from(options).every((option) => option.tabIndex === -1)).toBe(true);

      await dispatchKey(harness, { key: "End" });
      expect(
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent,
      ).toContain("/skill:review");
      await dispatchKey(harness, { key: "Home" });
      expect(
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent,
      ).toContain("/explain");

      const tab = await dispatchKey(harness, { key: "Tab" });
      expect(tab.defaultPrevented).toBe(false);
      expect(document.querySelector('[role="listbox"]')).toBeNull();

      await openSlash(harness);
      const shiftTab = await dispatchKey(harness, { key: "Tab", shiftKey: true });
      expect(shiftTab.defaultPrevented).toBe(false);
      expect(document.querySelector('[role="listbox"]')).toBeNull();

      await openSlash(harness);
      await dispatchKey(harness, { key: "Escape" });
      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(editorElement.hasAttribute("aria-expanded")).toBe(false);
      expect(editorElement.getAttribute("aria-label")).toBe("Message");
      expect(harness.controller.editor.getHTML()).toBe("<p>/</p>");
    } finally {
      await harness.dispose();
    }
  });

  it("keeps keyboard selection visible while navigating long results", async () => {
    const manyCommands: AgentCommand[] = Array.from({ length: 20 }, (_, index) => ({
      name: `command-${index}`,
      source: "prompt",
    }));
    const harness = await createHarness(readyState(manyCommands));
    try {
      await openSlash(harness);
      const scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
      const lastOption = document.querySelector<HTMLElement>('[role="option"]:last-of-type');
      Object.defineProperty(lastOption!, "scrollIntoView", {
        configurable: true,
        value: scrollIntoView,
      });

      await dispatchKey(harness, { key: "End" });
      expect(
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent,
      ).toContain("/command-19");
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    } finally {
      await harness.dispose();
    }
  });

  it("pointer selection and exact range replacement insert Pi invocation syntax", async () => {
    const harness = await createHarness(readyState());
    try {
      await openSlash(harness, "/rev");
      const skillOption = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
      ).find((option) => option.textContent?.includes("/skill:review"));
      const touchStart = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
      Object.defineProperty(touchStart, "pointerType", { value: "touch" });
      await act(async () => {
        skillOption?.dispatchEvent(touchStart);
      });
      expect(harness.controller.editor.getHTML()).toBe("<p>/rev</p>");

      const secondaryPress = new MouseEvent("pointerdown", {
        button: 2,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(secondaryPress, "pointerType", { value: "mouse" });
      await act(async () => {
        skillOption?.dispatchEvent(secondaryPress);
      });
      expect(harness.controller.editor.getHTML()).toBe("<p>/rev</p>");

      await act(async () => {
        skillOption?.dispatchEvent(
          new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(harness.controller.editor.getHTML()).toBe("<p>/skill:review </p>");

      harness.controller.editor.commands.setContent("/old");
      insertSlashCommand(
        harness.controller.editor,
        { from: 1, to: 5 },
        createSlashCommandSuggestionItems(commands)[0]!,
      );
      expect(harness.controller.editor.getHTML()).toBe("<p>/explain </p>");
    } finally {
      await harness.dispose();
    }
  });
});
