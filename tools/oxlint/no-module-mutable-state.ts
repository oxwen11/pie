import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Module-scope `let`/`var` is process-lifetime shared state. Function-local
// `let` (accumulators, `for (let i)`, factory closures) is allowed.

const isTestFile = (filename: string): boolean => {
  const normalized = filename.replaceAll("\\", "/");
  return (
    /\.(test|spec|test-d|spec-d)\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/e2e/")
  );
};

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
    if (isTestFile(context.filename)) return {};

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
              "Do not declare module-level let/var. Function-local let is allowed; mint identities with crypto.randomUUID() and keep live caches on an owner instead of the module.",
          });
        }
      },
    };
  },
});
