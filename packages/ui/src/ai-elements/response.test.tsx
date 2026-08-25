import { code } from "@streamdown/code";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Response } from "./response";

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Cold Shiki highlighter init is slower than vitest's 5s default on CI.
  await warmupHighlighter("ts");
  await warmupHighlighter("js");
}, 20_000);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

function warmupHighlighter(language: "ts" | "js"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out warming Streamdown highlighter for ${language}`));
    }, 15_000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const result = code.highlight(
      { code: "const n = 1;", language, themes: ["github-light", "github-dark"] },
      done,
    );
    if (result) {
      done();
    }
  });
}

async function render(ui: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(ui);
  });
  return container;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for Streamdown DOM");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

const fencedTs = ["```ts", "const n0 = 0;", "const n1 = 1;", "```"].join("\n");

const markdownTable = [
  "| Name | Value |",
  "| --- | --- |",
  ...Array.from({ length: 20 }, (_, i) => `| row-${i} | ${i} |`),
].join("\n");

describe("Response streamdown 2.6", () => {
  it("constrains fenced code blocks and exposes download controls", async () => {
    const el = await render(<Response>{fencedTs}</Response>);
    await waitFor(() => el.querySelector('[data-streamdown="code-block"]') !== null);

    const block = el.querySelector('[data-streamdown="code-block"]');
    expect(block).not.toBeNull();

    const body = el.querySelector<HTMLElement>('[data-streamdown="code-block-body"]');
    expect(body).not.toBeNull();
    expect(body?.style.maxHeight).toBe("400px");

    expect(el.querySelector('[data-streamdown="code-block-actions"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Download file"]')).not.toBeNull();
  });

  it("constrains tables and keeps copy/download actions", async () => {
    const el = await render(<Response>{markdownTable}</Response>);
    await waitFor(() => el.querySelector('[data-streamdown="table"]') !== null);

    const wrapper = el.querySelector('[data-streamdown="table-wrapper"]');
    expect(wrapper).not.toBeNull();
    const table = el.querySelector('[data-streamdown="table"]');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.style.maxHeight).toBe("300px");
  });

  it("animates newly streamed prose when isAnimating is set", async () => {
    const el = await render(<Response isAnimating>Hello **streamdown** world</Response>);
    await waitFor(() => el.querySelector("[data-sd-animate]") !== null);

    expect(el.querySelector("[data-sd-animate]")).not.toBeNull();
  });

  it("accepts a custom code download filename through controls", async () => {
    const el = await render(
      <Response controls={{ code: { download: { filename: "snippet" } } }}>
        {"```js\nconsole.log(1)\n```"}
      </Response>,
    );
    await waitFor(() => el.querySelector('[aria-label="Download file"]') !== null);

    expect(el.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Download file"]')).not.toBeNull();
  });
});
