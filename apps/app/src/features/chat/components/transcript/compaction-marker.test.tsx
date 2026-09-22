import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { CompactionMarker } from "./compaction-marker";
import { MessageView } from "./message-view";

describe("compaction markers", () => {
  it("shows running, failed, and canceled states from the data part", async () => {
    const view = await render(<CompactionMarker data={{ phase: "running" }} />);
    await expect.element(page.getByText("Compacting conversation…")).toBeVisible();

    await view.rerender(
      <CompactionMarker data={{ phase: "failed", error: "Compaction failed: quota" }} />,
    );
    await expect.element(page.getByText("Compaction failed: quota")).toBeVisible();

    await view.rerender(<CompactionMarker data={{ phase: "canceled" }} />);
    await expect.element(page.getByText("Compaction canceled")).toBeVisible();
  });

  it("renders a completed summary marker from MessageView", async () => {
    await render(
      <MessageView
        isStreaming={false}
        message={{
          id: "compact-1",
          role: "assistant",
          parts: [
            { type: "data-compaction", data: { phase: "completed", summary: "Earlier work" } },
          ],
        }}
      />,
    );
    await expect.element(page.getByText("Conversation compacted")).toBeVisible();
    await expect.element(page.getBySlot("marker")).toHaveAttribute("data-variant", "separator");
  });
});
