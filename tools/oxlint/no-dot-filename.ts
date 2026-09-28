import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Enforces flat file names: no ad-hoc dot suffixes (`message-view.logic.ts`).
// The basename may only carry dot segments from the known set — test/spec/
// test-d/spec-d/d/config/gen plus the e2e/smoke/browser qualifiers — before
// the extension. A new suffix kind is a convention: add the word to the set,
// not a dot to the file name.

const KNOWN_SEGMENTS = new Set([
  "test",
  "spec",
  "test-d",
  "spec-d",
  "d",
  "config",
  "gen",
  "e2e",
  "smoke",
  "browser",
  "vite",
]);

export const noDotFilename = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow ad-hoc dot suffixes in file names (foo.logic.ts -> foo-logic.ts).",
    },
    messages: {
      generic: 'File name "{{file}}" has a dot segment ".{{segment}}". Rename to "{{suggestion}}".',
    },
  },
  create(context) {
    return {
      Program(node: ESTree.Program) {
        const file = context.filename.replaceAll("\\", "/").split("/").pop() ?? "";
        // segments[0] is the stem, the last is the extension; middle segments
        // must each be a known qualifier.
        const segments = file.split(".");
        const bad = segments.slice(1, -1).find((segment) => !KNOWN_SEGMENTS.has(segment));
        if (bad === undefined) return;
        const suggestion = `${segments[0]}-${bad}.${segments.slice(2).join(".")}`;
        context.report({ node, messageId: "generic", data: { file, segment: bad, suggestion } });
      },
    };
  },
});
