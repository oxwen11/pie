import { code } from "@streamdown/code";
import { defaultRemarkPlugins } from "streamdown";
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { Response } from "./response";

beforeAll(async () => {
  await warmupHighlighter("ts");
  await warmupHighlighter("js");
}, 20_000);

function warmupHighlighter(language: "ts" | "js"): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 8_000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      const result = code.highlight(
        { code: "const n = 1;", language, themes: ["github-light", "github-dark"] },
        done,
      );
      if (result) {
        done();
      }
    } catch {
      done();
    }
  });
}

const fencedTs = ["```ts", "const n0 = 0;", "const n1 = 1;", "```"].join("\n");

const markdownTable = [
  "| Name | Value |",
  "| --- | --- |",
  ...Array.from({ length: 20 }, (_, i) => `| row-${i} | ${i} |`),
].join("\n");

describe("Response streamdown 2.6", () => {
  it("constrains fenced code blocks and exposes download controls", async () => {
    await render(<Response>{fencedTs}</Response>);
    await expect.element(page.getByLabelText("Download file")).toBeVisible();

    const root = page
      .getByLabelText("Download file")
      .element()
      .closest("[data-streamdown='code-block']");
    const body = root?.querySelector<HTMLElement>("[data-streamdown='code-block-body']");
    expect(body?.style.maxHeight).toBe("400px");
    expect(root?.querySelector("[data-streamdown='code-block-actions']")).not.toBeNull();
  });

  it("constrains tables and keeps copy/download actions", async () => {
    await render(<Response>{markdownTable}</Response>);
    await expect.element(page.getByRole("table")).toBeVisible();

    const table = page.getByRole("table").element();
    expect(table.closest("[data-streamdown='table']")).not.toBeNull();
    expect(table.parentElement?.style.maxHeight).toBe("300px");
  });

  it("animates newly streamed prose when isAnimating is set", async () => {
    await render(<Response isAnimating>Hello **streamdown** world</Response>);
    await expect.element(page.getByText("Hello")).toBeVisible();
    expect(page.getByText("Hello").element().closest("[data-sd-animate]")).not.toBeNull();
  });

  it("keeps CJK punctuation out of autolink hrefs", async () => {
    const url = "https://github.com/oxwen11/pie/pull/453";
    await render(
      <Response animated={false} remarkPlugins={Object.values(defaultRemarkPlugins)}>
        {`见 ${url}。导致找不到`}
      </Response>,
    );

    const link = page.getByRole("link");
    await expect.element(link).toHaveAttribute("href", url);
    expect(link.element().textContent).toBe(url);
    expect(link.element().parentElement?.textContent).toContain("。导致找不到");
  });

  it("leaves an explicit link destination that contains an ideographic full stop", async () => {
    const href = "https://example.com/a。";
    await render(<Response animated={false}>{`[说明](${href})`}</Response>);

    await expect
      .element(page.getByRole("link"))
      .toHaveAttribute("href", "https://example.com/a%E3%80%82");
  });

  it("accepts a custom code download filename through controls", async () => {
    await render(
      <Response controls={{ code: { download: { filename: "snippet" } } }}>
        {"```js\nconsole.log(1)\n```"}
      </Response>,
    );
    await expect.element(page.getByLabelText("Download file")).toBeVisible();
  });
});
