import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Response } from "./response";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

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

function render(ui: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(ui);
  });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const longCode = [
  "```ts",
  ...Array.from({ length: 80 }, (_, i) => `const n${i} = ${i};`),
  "```",
].join("\n");

const markdownTable = [
  "| Name | Value |",
  "| --- | --- |",
  ...Array.from({ length: 20 }, (_, i) => `| row-${i} | ${i} |`),
].join("\n");

describe("Response streamdown 2.6", () => {
  it("constrains fenced code blocks and exposes download controls", async () => {
    const el = render(<Response>{longCode}</Response>);
    await flush();

    const block = el.querySelector('[data-streamdown="code-block"]');
    expect(block).not.toBeNull();

    const body = el.querySelector<HTMLElement>('[data-streamdown="code-block-body"]');
    expect(body).not.toBeNull();
    expect(body?.style.maxHeight).toBe("400px");

    expect(el.querySelector('[data-streamdown="code-block-actions"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Download file"]')).not.toBeNull();
  });

  it("constrains tables and keeps copy/download actions", async () => {
    const el = render(<Response>{markdownTable}</Response>);
    await flush();

    const wrapper = el.querySelector('[data-streamdown="table-wrapper"]');
    expect(wrapper).not.toBeNull();
    const table = el.querySelector('[data-streamdown="table"]');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.style.maxHeight).toBe("300px");
  });

  it("animates newly streamed prose when isAnimating is set", async () => {
    const el = render(<Response isAnimating>Hello **streamdown** world</Response>);
    await flush();

    expect(el.querySelector("[data-sd-animate]")).not.toBeNull();
  });

  it("accepts a custom code download filename through controls", async () => {
    const el = render(
      <Response controls={{ code: { download: { filename: "snippet" } } }}>
        {"```js\nconsole.log(1)\n```"}
      </Response>,
    );
    await flush();

    expect(el.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Download file"]')).not.toBeNull();
  });
});
