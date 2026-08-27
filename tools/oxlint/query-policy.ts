import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Enforces TanStack Query cache-policy conventions in
// .agents/rules/frontend-state.md: do not repeat QueryClient defaults.
// Per-query capabilities (select, enabled, retry, placeholderData, or a
// cache option that actually differs) stay at the call site.

const APP_SRC = "apps/app/";
const QUERY_HOOKS = new Set([
  "useQuery",
  "useQueries",
  "useSuspenseQuery",
  "useSuspenseQueries",
  "useInfiniteQuery",
]);

const isAppSrc = (filename: string): boolean => filename.replaceAll("\\", "/").includes(APP_SRC);

const isTestFile = (filename: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename.replaceAll("\\", "/"));

const calleeName = (node: ESTree.Expression): string | null => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
};

const unwrap = (node: ESTree.Node): ESTree.Node => {
  let current: ESTree.Node = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "ChainExpression"
  ) {
    current = current.expression;
  }
  return current;
};

const propertyKey = (node: ESTree.Node): string | number | boolean | null => {
  if (node.type !== "Property" || node.computed) return null;
  const { key } = node;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") {
    const { value } = key;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : null;
  }
  return null;
};

const isInfinity = (node: ESTree.Node): boolean => {
  const value = unwrap(node);
  return value.type === "Identifier" && value.name === "Infinity";
};

const isAlways = (node: ESTree.Node): boolean => {
  const value = unwrap(node);
  return value.type === "Literal" && value.value === "always";
};

export const noQueryClientDefaultOverrides = defineRule({
  create(context) {
    if (!isAppSrc(context.filename) || isTestFile(context.filename)) return {};

    let queryCallDepth = 0;

    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name !== null && QUERY_HOOKS.has(name)) queryCallDepth += 1;
      },
      "CallExpression:exit"(node) {
        const name = calleeName(node.callee);
        if (name !== null && QUERY_HOOKS.has(name)) queryCallDepth -= 1;
      },
      Property(node) {
        if (queryCallDepth === 0) return;
        const key = propertyKey(node);
        if (!("value" in node)) return;
        if (key === "staleTime" && isInfinity(node.value)) {
          context.report({
            node,
            message:
              "Do not repeat QueryClient defaults. staleTime: Infinity is set in createAppClients. Override only when this key is actually special.",
          });
        }
        if (key === "refetchOnWindowFocus" && isAlways(node.value)) {
          context.report({
            node,
            message:
              'Do not repeat QueryClient defaults. refetchOnWindowFocus: "always" is set in createAppClients. Override only when this query must differ.',
          });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "pie-query" },
  rules: {
    "no-query-client-default-overrides": noQueryClientDefaultOverrides,
  },
});
