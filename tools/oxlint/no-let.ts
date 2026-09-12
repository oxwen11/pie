import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Fork of eslint-plugin-functional `no-let` (MIT), adapted to oxlint JS
// plugins so it does not load @typescript-eslint (incompatible with TS 7).
// https://github.com/eslint-functional/eslint-plugin-functional/blob/main/src/rules/no-let.ts

type Options = {
  allowInForLoopInit?: boolean;
  allowInFunctions?: boolean;
};

const isFunctionLike = (
  node: ESTree.Node,
): node is ESTree.ArrowFunctionExpression | ESTree.Function =>
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression";

const isInFunctionBody = (node: ESTree.Node): boolean => {
  let child: ESTree.Node = node;
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (isFunctionLike(current) && current.body === child) return true;
    child = current;
    current = current.parent;
  }
  return false;
};

const isInForLoopInitializer = (node: ESTree.Node): boolean => {
  let child: ESTree.Node = node;
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (current.type === "ForStatement" && current.init === child) return true;
    child = current;
    current = current.parent;
  }
  return false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const readOptions = (raw: unknown): Required<Options> => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- Array.isArray(unknown) is any[]
  const option: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (!isRecord(option)) {
    return { allowInForLoopInit: false, allowInFunctions: false };
  }
  return {
    allowInForLoopInit: option.allowInForLoopInit === true,
    allowInFunctions: option.allowInFunctions === true,
  };
};

export const noLet = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow mutable variables.",
    },
    messages: {
      generic: "Unexpected let, use const instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInForLoopInit: { type: "boolean" },
          allowInFunctions: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInForLoopInit: false, allowInFunctions: false }],
  },
  create(context) {
    const options = readOptions(context.options);

    return {
      VariableDeclaration(node) {
        if (node.kind !== "let") return;
        if (node.declare === true) return;
        if (options.allowInFunctions && isInFunctionBody(node)) return;
        if (options.allowInForLoopInit && isInForLoopInitializer(node)) return;
        context.report({ node, messageId: "generic" });
      },
    };
  },
});
