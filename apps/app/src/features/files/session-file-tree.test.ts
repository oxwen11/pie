import { describe, expect, it } from "vitest";

import { getSessionFileTree, syncSessionFileTree } from "./session-file-tree";

describe("session file tree", () => {
  it("preserves expanded directories across complete tree resets", () => {
    const state = getSessionFileTree(`test-${crypto.randomUUID()}`);
    syncSessionFileTree(state, [
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" },
    ]);

    const src = state.model.getItem("src/");
    expect(src?.isDirectory()).toBe(true);
    if (src === null || !src.isDirectory() || !("expand" in src)) {
      throw new Error("src directory missing");
    }
    src.expand();

    syncSessionFileTree(state, [
      { path: "README.md", type: "file" },
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" },
      { path: "src/new.ts", type: "file" },
    ]);

    const refreshedSrc = state.model.getItem("src/");
    expect(refreshedSrc?.isDirectory()).toBe(true);
    if (refreshedSrc === null || !refreshedSrc.isDirectory() || !("isExpanded" in refreshedSrc)) {
      throw new Error("refreshed src directory missing");
    }
    expect(refreshedSrc.isExpanded()).toBe(true);
    state.model.cleanUp();
  });
});
