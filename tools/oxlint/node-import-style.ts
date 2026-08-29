import module from "node:module";

import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { noRestrictedDisable } from "./no-restricted-disable.ts";

const { isBuiltin } = module;

// Enforces the repo convention for Node builtin imports:
//   import fs from "node:fs/promises"
// i.e. a lone default import bound to the module's canonical name, with call
// sites using property access (fs.rename(...)). Named and namespace specifiers
// are rejected; so are ad-hoc local names (nodePath, NodeAssert). The `node:`
// prefix itself is `unicorn/prefer-node-protocol`'s job. Type-only imports are
// exempt: types have no runtime binding.
//
// Canonical name: the module's first path segment, camelCased ("child_process"
// -> childProcess, "fs/promises" -> fs, "assert/strict" -> assert). Only when
// one file imports two builtins sharing a first segment (node:fs AND
// node:fs/promises) does the subpath import fall back to the full camelCased
// path (fsPromises).

type BuiltinImport = {
  source: string;
  node: ESTree.ImportDeclaration;
};

const bareName = (source: string): string => source.replace(/^node:/, "");
const camelize = (value: string): string =>
  value.replaceAll(/[/_](\w)/g, (_, char: string) => char.toUpperCase());
const firstSegment = (source: string): string => bareName(source).split("/")[0] ?? bareName(source);

const canonicalNames = (declarations: BuiltinImport[]): ((source: string) => string) => {
  const byFirst = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const first = firstSegment(declaration.source);
    const names = byFirst.get(first);
    if (names === undefined) {
      byFirst.set(first, new Set([bareName(declaration.source)]));
    } else {
      names.add(bareName(declaration.source));
    }
  }
  return (source) => {
    const bare = bareName(source);
    const first = firstSegment(source);
    const names = byFirst.get(first);
    const contested = names !== undefined && names.size > 1 && bare !== first;
    return camelize(contested ? bare : first);
  };
};

const nodeImportStyleRule = defineRule({
  create(context) {
    const declarations: BuiltinImport[] = [];

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!isBuiltin(source)) return;
        if (node.importKind === "type") return;

        declarations.push({ source, node });

        const short = camelize(firstSegment(source));
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
            context.report({
              node: specifier,
              message: `Use a default import for Node builtins: import ${short} from "node:${bareName(source)}", then call ${short}.<member> at the use site.`,
            });
          } else if (specifier.type === "ImportNamespaceSpecifier") {
            context.report({
              node: specifier,
              message: `Use a default import for Node builtins, not a namespace import: import ${short} from "node:${bareName(source)}".`,
            });
          }
        }
      },

      "Program:exit"() {
        const expectedFor = canonicalNames(declarations);
        for (const { source, node } of declarations) {
          const def = node.specifiers.find(
            (specifier) => specifier.type === "ImportDefaultSpecifier",
          );
          if (def === undefined) continue;
          const expected = expectedFor(source);
          if (def.local.name !== expected) {
            context.report({
              node: def,
              message: `Import "${source}" under its canonical name: import ${expected} from "node:${bareName(source)}".`,
            });
          }
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "pie" },
  rules: {
    "node-import-style": nodeImportStyleRule,
    "no-restricted-disable": noRestrictedDisable,
  },
});
