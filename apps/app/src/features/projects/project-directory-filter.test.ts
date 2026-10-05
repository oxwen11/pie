import { describe, expect, it } from "vitest";

import {
  folderBrowserDrillPath,
  folderBrowserInputValue,
  folderBrowserLeafFilter,
  isProjectDirectoryEntryVisible,
  type ProjectDirectoryEntry,
  projectDirectoryEntryMatches,
} from "./project-directory-filter";

const hidden: ProjectDirectoryEntry = {
  value: "/Users/dinq/.herdr",
  label: ".herdr",
  kind: "dir",
};

const regular: ProjectDirectoryEntry = {
  value: "/Users/dinq/Code",
  label: "Code",
  kind: "dir",
};

describe("project directory filter", () => {
  it("hides dotfolders until the search starts with a dot", () => {
    expect(isProjectDirectoryEntryVisible(hidden, "")).toBe(false);
    expect(isProjectDirectoryEntryVisible(hidden, "herdr")).toBe(false);
    expect(isProjectDirectoryEntryVisible(hidden, ".")).toBe(true);
    expect(isProjectDirectoryEntryVisible(hidden, ".her")).toBe(true);
    expect(isProjectDirectoryEntryVisible(regular, "")).toBe(true);
  });

  it("keeps path characters in the field and only drills on a new trailing separator", () => {
    const current = "/Users/dinq";
    for (const next of [`${current}/`, `${current}\\`, "~/projects/my-app", "Code.", "a b"]) {
      expect(folderBrowserInputValue(next, current)).toBe(next);
    }
    expect(folderBrowserDrillPath(current, `${current}/`)).toBeNull();
    expect(folderBrowserDrillPath(current, `${current}\\`)).toBeNull();
    expect(folderBrowserDrillPath(current, "/Users/dinq/Code/")).toBe("/Users/dinq/Code");
    expect(folderBrowserDrillPath(current, "C:\\Users\\")).toBe(String.raw`C:\Users`);
    expect(folderBrowserLeafFilter(current, `${current}/Code`)).toBe("Code");
    expect(folderBrowserLeafFilter(current, "~/etc")).toBe("~/etc");
  });

  it("reveals and matches a dotfolder searched by its full path", () => {
    expect(isProjectDirectoryEntryVisible(hidden, hidden.value)).toBe(true);
    expect(isProjectDirectoryEntryVisible(hidden, `${hidden.value}/`)).toBe(true);
    expect(projectDirectoryEntryMatches(hidden, hidden.value)).toBe(true);
    expect(projectDirectoryEntryMatches(hidden, `${hidden.value}/`)).toBe(true);
  });
});
