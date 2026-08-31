// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SessionPullRequestIndicator } from "./session-pull-request-indicator";
import { SessionStatusIndicator } from "./session-status-indicator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

const renderPullRequestIndicator = (
  lifecycle: Parameters<typeof SessionPullRequestIndicator>[0]["lifecycle"],
) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(SessionPullRequestIndicator, { lifecycle }));
  });
  return container;
};

describe("SessionStatusIndicator", () => {
  it("shows a pulsing green dot while running", () => {
    const node = renderIndicator("running");
    const dot = node.querySelector<HTMLSpanElement>("span > span");
    expect(dot?.className).toContain("animate-pulse");
    expect(dot?.className).toContain("bg-emerald-500");
    expect(dot?.getAttribute("title")).toBe("A turn is running in this session");
  });

  it("shows an amber dot while waiting for user action", () => {
    const node = renderIndicator("requires_action");
    const dot = node.querySelector<HTMLSpanElement>("span > span");
    expect(dot?.className).toContain("bg-warning");
    expect(dot?.getAttribute("title")).toBe("Waiting for your action");
  });

  it("shows a red dot when the session crashed", () => {
    const node = renderIndicator("crashed");
    const dot = node.querySelector<HTMLSpanElement>("span > span");
    expect(dot?.className).toContain("bg-destructive");
    expect(dot?.getAttribute("title")).toBe("Session crashed");
  });

  it("reserves a fixed slot for idle or missing status", () => {
    for (const phase of ["idle", undefined] as const) {
      const node = renderIndicator(phase);
      const slot = node.querySelector("span");
      expect(slot?.className).toContain("size-2");
      expect(slot?.className).toContain("me-2");
      expect(slot?.querySelector("span")).toBeNull();
    }
  });
});

describe("SessionPullRequestIndicator", () => {
  it("uses distinct accessible icons for open, draft, closed, and merged PRs", () => {
    const cases = [
      [
        { type: "open", draft: false },
        "Open pull request",
        "lucide-git-pull-request",
        "text-pull-request-open",
      ],
      [
        { type: "open", draft: true },
        "Draft pull request",
        "lucide-git-pull-request-draft",
        "text-pull-request-draft",
      ],
      [
        { type: "closed" },
        "Closed pull request",
        "lucide-git-pull-request-closed",
        "text-pull-request-closed",
      ],
      [{ type: "merged" }, "Pull request merged", "lucide-git-merge", "text-pull-request-merged"],
    ] as const;

    for (const [lifecycle, label, iconClass, colorClass] of cases) {
      const node = renderPullRequestIndicator(lifecycle);
      const indicator = node.querySelector('[role="img"]');
      expect(indicator?.getAttribute("aria-label")).toBe(label);
      expect(indicator?.classList.contains(colorClass)).toBe(true);
      expect(indicator?.querySelector("svg")?.classList.contains(iconClass)).toBe(true);
      act(() => root?.unmount());
      node.remove();
      root = undefined;
      container = undefined;
    }
  });

  it("renders nothing without a current pull request status", () => {
    expect(renderPullRequestIndicator(undefined).childElementCount).toBe(0);
  });
});
