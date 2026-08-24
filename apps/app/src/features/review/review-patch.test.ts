import type { GitFileDiff, GitPatchFileIssue, GitReviewFile } from "@getpie/contract/git";
import { describe, expect, it } from "vitest";

import { parseReviewPatch, toLoadedDiffFiles } from "./review-patch";

const PATCH = `diff --git a/a.txt b/a.txt
index 45b983b..ce01362 100644
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-hi
+hello
diff --git a/added file.txt b/added file.txt
new file mode 100644
--- /dev/null
+++ b/added file.txt
@@ -0,0 +1,1 @@
+new
\\ No newline at end of file
`;

const PURE_RENAME_PATCH = `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`;

describe("review patch", () => {
  it("parses patch metadata for CodeView without full file contents", () => {
    const files = parseReviewPatch(PATCH, [
      { path: "added file.txt", status: "added" },
      { path: "a.txt", status: "modified" },
    ]);

    expect(files.map((file) => file.name)).toEqual(["added file.txt", "a.txt"]);
    expect(files.every((file) => file.isPartial)).toBe(true);
    expect(files[1]?.unifiedLineCount).toBe(2);
  });

  it("normalizes Git C-quoted paths before matching review files", () => {
    const path = "back\\slash\tname.txt";
    const oldPath = JSON.stringify(`a/${path}`);
    const newPath = JSON.stringify(`b/${path}`);
    const patch = `diff --git ${oldPath} ${newPath}\n--- ${oldPath}\n+++ ${newPath}\n@@ -1 +1 @@\n-old\n+new\n`;

    const parsed = parseReviewPatch(patch, [{ path, status: "modified" }]);

    expect(parsed.map((file) => file.name)).toEqual([path]);
  });

  it("creates explicit placeholders for unavailable patch files", () => {
    const files: GitReviewFile[] = [
      { path: "binary.bin", status: "added" },
      { path: "large.txt", status: "modified" },
    ];
    const issues: GitPatchFileIssue[] = [
      { path: "binary.bin", reason: "binary" },
      { path: "large.txt", reason: "too-large" },
    ];

    const parsed = parseReviewPatch("", files, issues);

    expect(parsed.map((file) => [file.name, file.type, file.hunks.length])).toEqual([
      ["binary.bin", "new", 0],
      ["large.txt", "change", 0],
    ]);
  });

  it("converts a hydrated changed diff to Pierre file contents", () => {
    const [fileDiff] = parseReviewPatch(PATCH);
    const diff: GitFileDiff = {
      path: "a.txt",
      status: "modified",
      oldContents: "hi\n",
      newContents: "hello\n",
      binary: false,
    };

    expect(toLoadedDiffFiles(fileDiff!, diff)).toEqual({
      oldFile: { name: "a.txt", contents: "hi\n" },
      newFile: { name: "a.txt", contents: "hello\n" },
    });
  });

  it("hydrates a pure rename with only the renamed file", () => {
    const [fileDiff] = parseReviewPatch(PURE_RENAME_PATCH);
    const diff: GitFileDiff = {
      path: "new.txt",
      oldPath: "old.txt",
      status: "renamed",
      oldContents: "same\n",
      newContents: "same\n",
      binary: false,
    };

    expect(toLoadedDiffFiles(fileDiff!, diff)).toEqual({
      oldFile: null,
      newFile: { name: "new.txt", contents: "same\n" },
    });
  });
});
