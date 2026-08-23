// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SessionStatusIndicator } from "./session-status-indicator";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const renderIndicator = (phase: Parameters<typeof SessionStatusIndicator>[0]["phase"]) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(SessionStatusIndicator, { phase }));
  });
  return container;
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("SessionStatusIndicator", () => {
  it("shows a pulsing green dot while running", () => {
    const node = renderIndicator("running");
    const dot = node.querySelector("span");
    expect(dot?.className).toContain("animate-pulse");
    expect(dot?.className).toContain("bg-emerald-500");
    expect(dot?.title).toBe("A turn is running in this session");
  });

  it("shows an amber dot while waiting for user action", () => {
    const node = renderIndicator("requires_action");
    const dot = node.querySelector("span");
    expect(dot?.className).toContain("bg-warning");
    expect(dot?.title).toBe("Waiting for your action");
  });

  it("shows a red dot when the session crashed", () => {
    const node = renderIndicator("crashed");
    const dot = node.querySelector("span");
    expect(dot?.className).toContain("bg-destructive");
    expect(dot?.title).toBe("Session crashed");
  });

  it("shows nothing for idle or missing status", () => {
    expect(renderIndicator("idle").querySelector("span")).toBeNull();
    expect(renderIndicator(undefined).querySelector("span")).toBeNull();
  });
});
