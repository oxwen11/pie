// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ModelErrorCard } from "./model-error-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderError(message: string): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<ModelErrorCard error={new Error(message)} />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ModelErrorCard", () => {
  it("turns a provider rate-limit response into a readable card", () => {
    const node = renderError(
      '429: {"code":"1308","message":"已达到 5 小时的使用上限。您的限额将在 2026-08-28 00:08:44 重置。"}',
    );

    expect(node.querySelector("[role=alert]")).not.toBeNull();
    expect(node.textContent).toContain("Model usage limit reached");
    expect(node.textContent).toContain("已达到 5 小时的使用上限");
    expect(node.textContent).not.toContain("HTTP 429");
    expect(node.textContent).not.toContain("1308");
    expect(node.textContent).not.toContain('{"code"');
  });

  it("keeps an unstructured error readable", () => {
    const node = renderError("Connection lost while contacting the model");

    expect(node.textContent).toContain("Model request failed");
    expect(node.textContent).toContain("Connection lost while contacting the model");
    expect(node.textContent).not.toContain("HTTP");
  });
});
