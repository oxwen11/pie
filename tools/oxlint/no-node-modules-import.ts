import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Forbids import/export/require specifiers that walk into node_modules via a
// relative or absolute path. Dependents should import the package name so the
// package manager and TypeScript resolve it.

const NODE_MODULES_SEGMENT = /(^|\/)node_modules(\/|$)/u;

const MESSAGE =
  'Do not import through node_modules. Import the package by name instead of a relative path like "../../../../node_modules/<pkg>".';

const isNodeModulesSpecifier = (value: string): boolean =>
  NODE_MODULES_SEGMENT.test(value.replaceAll("\\", "/"));

const stringLiteralValue = (node: ESTree.Node): string | null => {
  if (node.type !== "Literal") return null;
  if (typeof node.value !== "string") return null;
  return node.value;
};

export const noNodeModulesImport = defineRule({
  create(context) {
    const reportIfBanned = (node: ESTree.Node, value: string): void => {
      if (!isNodeModulesSpecifier(value)) return;
      context.report({ node, message: MESSAGE });
    };

    const reportLiteral = (node: ESTree.Node): void => {
      const value = stringLiteralValue(node);
      if (value === null) return;
      reportIfBanned(node, value);
    };

    return {
      ImportDeclaration(node) {
        reportIfBanned(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source === null) return;
        reportIfBanned(node.source, node.source.value);
      },
      ExportAllDeclaration(node) {
        reportIfBanned(node.source, node.source.value);
      },
      ImportExpression(node) {
        reportLiteral(node.source);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const arg = node.arguments[0];
        if (arg === undefined || arg.type === "SpreadElement") return;
        reportLiteral(arg);
      },
      TSImportEqualsDeclaration(node) {
        const ref = node.moduleReference;
        if (ref.type !== "TSExternalModuleReference") return;
        reportIfBanned(ref.expression, ref.expression.value);
      },
    };
  },
});
