import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToolPart } from "./tool-part";

describe("ToolPart", () => {
  it("renders a Pi read as its path", async () => {
    await render(
      <ToolPart
        part={{
          type: "tool-read",
          toolCallId: "read-1",
          state: "output-available",
          input: { path: "/tmp/secret.txt" },
          output: { content: "must not render" },
        }}
      />,
    );

    await expect.element(page.getByText("read /tmp/secret.txt")).toBeVisible();
  });

  it("does not render generic tool output", async () => {
    await render(
      <ToolPart
        part={{
          type: "dynamic-tool",
          toolName: "custom",
          toolCallId: "custom-1",
          state: "output-available",
          input: { query: "visible input" },
          output: "must not render",
        }}
      />,
    );

    await expect.element(page.getByText("Output")).not.toBeInTheDocument();
    await expect.element(page.getByText("must not render")).not.toBeInTheDocument();
  });
});
