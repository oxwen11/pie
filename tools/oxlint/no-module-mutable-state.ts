import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// UI modules must not keep mutable bindings at module scope. A `let` counter
// or `var` cache survives every mount, collides after reload, and is the
// shape ChatManager was moved off of. Mint identities with
// `crypto.randomUUID()`; live caches belong on an App-mount owner.

const UI_ROOTS = ["apps/app/", "packages/ui/", "apps/desktop/src/renderer/"] as const;

const isUiFile = (filename: string): boolean => {
  const normalized = filename.replaceAll("\\", "/");
  return UI_ROOTS.some((root) => normalized.includes(root));
};

const isTestFile = (filename: string): boolean =>
  /\.(test|spec|test-d|spec-d)\.[cm]?[jt]sx?$/.test(filename.replaceAll("\\", "/")) ||
  filename.replaceAll("\\", "/").includes("/__tests__/");

const moduleVariableDeclaration = (statement: ESTree.Node): ESTree.VariableDeclaration | null => {
  if (statement.type === "VariableDeclaration") return statement;
  if (
    statement.type === "ExportNamedDeclaration" &&
    statement.declaration?.type === "VariableDeclaration"
  ) {
    return statement.declaration;
  }
  return null;
};

export const noModuleMutableState = defineRule({
  create(context) {
    if (!isUiFile(context.filename) || isTestFile(context.filename)) return {};

    return {
      Program(node) {
        for (const statement of node.body) {
          const declaration = moduleVariableDeclaration(statement);
          if (declaration === null) continue;
          if (declaration.declare === true) continue;
          if (declaration.kind !== "let" && declaration.kind !== "var") continue;
          context.report({
            node: declaration,
            message:
              "UI modules must not declare module-level let/var. Mint identities with crypto.randomUUID(), and keep live caches on an App-mount owner instead of the module.",
          });
        }
      },
    };
  },
});
