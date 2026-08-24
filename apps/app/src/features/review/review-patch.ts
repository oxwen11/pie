import type {
  GitFileDiff,
  GitPatchFileIssue,
  GitReviewFile,
  GitReviewFileStatus,
} from "@getpie/contract/git";
import {
  parsePatchFiles,
  type ChangeTypes,
  type FileDiffLoadedFiles,
  type FileDiffMetadata,
} from "@pierre/diffs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeGitPath(value: string): string {
  const bytes: number[] = [];
  const append = (text: string): void => {
    bytes.push(...encoder.encode(text));
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== "\\") {
      const codePoint = value.codePointAt(index)!;
      const text = String.fromCodePoint(codePoint);
      append(text);
      index += text.length - 1;
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === undefined) {
      append("\\");
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(value[index + octal.length + 1] ?? "")) {
        octal += value[index + octal.length + 1];
      }
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    if (escaped === "u") {
      const hex = value.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        append(String.fromCodePoint(Number.parseInt(hex, 16)));
        index += 5;
        continue;
      }
    }

    const replacements: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    append(replacements[escaped] ?? escaped);
    index += 1;
  }

  return decoder.decode(Uint8Array.from(bytes));
}

function changeType(status: GitReviewFileStatus): ChangeTypes {
  switch (status) {
    case "added":
      return "new";
    case "deleted":
      return "deleted";
    case "renamed":
      return "rename-changed";
    default:
      return "change";
  }
}

function unavailableFileDiff(file: GitReviewFile): FileDiffMetadata {
  return {
    name: file.path,
    ...(file.oldPath === undefined ? {} : { prevName: file.oldPath }),
    type: changeType(file.status),
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    additionLines: [],
    deletionLines: [],
  };
}

export function parseReviewPatch(
  patch: string,
  files?: ReadonlyArray<GitReviewFile>,
  issues: ReadonlyArray<GitPatchFileIssue> = [],
): ReadonlyArray<FileDiffMetadata> {
  const parsed = parsePatchFiles(patch).flatMap((entry) => entry.files);
  for (const fileDiff of parsed) {
    fileDiff.name = decodeGitPath(fileDiff.name);
    if (fileDiff.prevName !== undefined) fileDiff.prevName = decodeGitPath(fileDiff.prevName);
  }
  if (files === undefined) return parsed;

  const byPath = new Map(parsed.map((fileDiff) => [fileDiff.name, fileDiff]));
  const issuePaths = new Set(issues.map((issue) => issue.path));
  return files.flatMap((file) => {
    const fileDiff = byPath.get(file.path);
    if (fileDiff !== undefined) return [fileDiff];
    return issuePaths.has(file.path) ? [unavailableFileDiff(file)] : [];
  });
}

export function toLoadedDiffFiles(
  fileDiff: FileDiffMetadata,
  diff: GitFileDiff,
): FileDiffLoadedFiles {
  if (diff.newContents === null) {
    throw new Error(`Cannot hydrate deleted diff: ${diff.path}`);
  }

  const newFile = { name: diff.path, contents: diff.newContents };
  if (fileDiff.type === "rename-pure") return { oldFile: null, newFile };
  if (diff.oldContents === null) {
    throw new Error(`Cannot hydrate diff without old contents: ${diff.path}`);
  }

  return {
    oldFile: { name: diff.oldPath ?? diff.path, contents: diff.oldContents },
    newFile,
  };
}
