import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// This repo does not enable no-floating-promises. Prefixing a call with `void`
// to discard its result is cargo-cult — the statement already discards it.
// Unused bindings should use a `_` prefix, not `void ident`.
//
// The one legitimate `void` is consuming a `satisfies` expression so a switch
// default stays exhaustive: `void (x satisfies never)`.

const unwrapParentheses = (node: ESTree.Expression): ESTree.Expression => {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
};

const isSatisfiesExpression = (node: ESTree.Expression): boolean =>
  unwrapParentheses(node).type === "TSSatisfiesExpression";

const isBareIdentifier = (node: ESTree.Expression): boolean =>
  unwrapParentheses(node).type === "Identifier";

const isLiteral = (node: ESTree.Expression): boolean => unwrapParentheses(node).type === "Literal";

const canStripVoid = (node: ESTree.UnaryExpression): boolean => {
  if (isBareIdentifier(node.argument) || isLiteral(node.argument)) return false;
  const { parent } = node;
  return (
    parent.type === "ExpressionStatement" ||
    (parent.type === "ArrowFunctionExpression" && parent.body === node)
  );
};

export const noVoidExpression = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow void-prefix discard except satisfies exhaustiveness checks.",
    },
    messages: {
      discard:
        "Do not prefix expressions with void to discard a value. Write the call as a statement.",
      unused: "Do not use void to mark a binding as used. Prefix the binding with _ or omit it.",
    },
    fixable: "code",
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator !== "void") return;
        if (isSatisfiesExpression(node.argument)) return;

        const unused = isBareIdentifier(node.argument);
        if (unused || !canStripVoid(node)) {
          context.report({
            node,
            messageId: unused ? "unused" : "discard",
          });
          return;
        }
        context.report({
          node,
          messageId: "discard",
          fix: (fixer) => fixer.replaceText(node, context.sourceCode.getText(node.argument)),
        });
      },
    };
  },
});
