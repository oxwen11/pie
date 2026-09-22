import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

window.matchMedia = (query) => ({
  addEventListener() {
    /* width comes from the fixture, not the viewport */
  },
  addListener() {
    /* MediaQueryList still types this deprecated alias */
  },
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener() {
    /* width comes from the fixture, not the viewport */
  },
  removeListener() {
    /* MediaQueryList still types this deprecated alias */
  },
});

import {
  WorkspaceSplit,
  WorkspaceSplitPanels,
  WorkspaceSplitPrimary,
  WorkspaceSplitSecondary,
  WorkspaceSplitTrigger,
} from "./workspace-split";

function SplitFixture({ width }: { readonly width: number }) {
  return (
    <div className="flex" style={{ width, height: 400 }}>
      <WorkspaceSplit label="Demo">
        <div>Toolbar</div>
        <WorkspaceSplitPanels>
          <WorkspaceSplitPrimary>
            <div>Preview</div>
            <WorkspaceSplitTrigger className="absolute end-11 top-1.5 z-10" />
          </WorkspaceSplitPrimary>
          <WorkspaceSplitSecondary>
            <div>Tree</div>
          </WorkspaceSplitSecondary>
        </WorkspaceSplitPanels>
      </WorkspaceSplit>
    </div>
  );
}

describe("WorkspaceSplit", () => {
  it("docks the file tree beside the preview when the column is wide", async () => {
    await render(<SplitFixture width={800} />);

    await expect.element(page.getByText("Toolbar")).toBeVisible();
    await expect.element(page.getByText("Preview")).toBeVisible();
    await expect.element(page.getByText("Tree")).toBeVisible();
    await expect
      .element(page.getByRole("separator", { name: "Resize file tree" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open file tree for Demo" }))
      .not.toBeInTheDocument();
  });

  it("moves the file tree into a drawer when the column is narrow", async () => {
    await render(<SplitFixture width={200} />);

    await expect.element(page.getByText("Toolbar")).toBeVisible();
    await expect.element(page.getByText("Preview")).toBeVisible();
    await expect
      .element(page.getByRole("separator", { name: "Resize file tree" }))
      .not.toBeInTheDocument();

    const openTree = page.getByRole("button", { name: "Open file tree for Demo" });
    await expect.element(openTree).toBeVisible();
    await openTree.click();
    await expect.element(page.getByRole("dialog", { name: "Project files" })).toBeVisible();
    await expect.element(page.getByText("Tree")).toBeVisible();
  });
});
