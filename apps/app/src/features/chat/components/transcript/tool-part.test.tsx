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
          output: { content: [] as [], details: undefined },
        }}
      />,
    );

    await expect.element(page.getByText("read /tmp/secret.txt")).toBeVisible();
  });

  it("renders built-in tools as one typed line each", async () => {
    await render(
      <div>
        <ToolPart
          part={{
            type: "tool-edit",
            toolCallId: "edit-1",
            state: "output-available",
            input: { path: "/tmp/a.ts", edits: [{ oldText: "x", newText: "y" }] },
            output: { content: [] as [], details: { diff: "", patch: "" } },
          }}
        />
        <ToolPart
          part={{
            type: "tool-bash",
            toolCallId: "bash-1",
            state: "output-available",
            input: { command: "pnpm test" },
            output: { content: [] as [], details: {} },
          }}
        />
      </div>,
    );

    await expect.element(page.getByText("edit /tmp/a.ts")).toBeVisible();
    await expect.element(page.getByText("bash pnpm test")).toBeVisible();
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
