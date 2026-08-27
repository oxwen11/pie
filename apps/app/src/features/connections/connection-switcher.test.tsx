// @vitest-environment jsdom
import { SidebarProvider } from "@getpie/ui/components/sidebar";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConnectionSwitcher } from "@/features/connections/connection-switcher";
import { LOCAL_ENVIRONMENT_ID, type PlatformSsh } from "@/platform";
import { PlatformProvider } from "@/platform-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;

if (typeof PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(
      type: string,
      init?: MouseEventInit & { pointerId?: number; pointerType?: string },
    ) {
      super(type, init);
      this.pointerId = init?.pointerId ?? 1;
      this.pointerType = init?.pointerType ?? "mouse";
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", { value: PointerEventPolyfill });
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const hangingSnapshot = {
  revision: 0,
  activeId: LOCAL_ENVIRONMENT_ID,
  connectingLabel: null,
  remotes: [],
} as const;

const hangingSsh: PlatformSsh = {
  client: { available: true },
  environments: {
    getSnapshot: () => hangingSnapshot,
    subscribe: () => () => {},
  },
  discoverHosts: () => new Promise(() => {}),
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

function dispatch(target: EventTarget, type: string): void {
  const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  target.dispatchEvent(
    new EventCtor(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  );
}

async function flushFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

beforeEach(() => {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ConnectionSwitcher", () => {
  it("opens the Add SSH host dialog after the server menu closes", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          SidebarProvider,
          null,
          createElement(
            PlatformProvider,
            { value: { ssh: hangingSsh } },
            createElement(ConnectionSwitcher),
          ),
        ),
      );
    });

    const trigger =
      document.querySelector('[data-slot="menu-trigger"]') ??
      document.querySelector('[data-slot="sidebar-menu-button"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      dispatch(trigger!, "pointerdown");
      dispatch(trigger!, "mousedown");
      await flushFrames();
    });

    const addItem = [...document.querySelectorAll('[data-slot="menu-item"]')].find((node) =>
      node.textContent?.includes("Add SSH host"),
    );
    expect(addItem).not.toBeUndefined();

    await act(async () => {
      dispatch(addItem!, "pointerdown");
      dispatch(addItem!, "mousedown");
      dispatch(addItem!, "mouseup");
      dispatch(addItem!, "click");
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });

    expect(document.body.textContent).toContain("Add SSH host");
    expect(document.getElementById("ssh-target")).not.toBeNull();
  });
});
