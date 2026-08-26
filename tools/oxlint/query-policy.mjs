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

const isAppSrc = (filename) => filename.replaceAll("\\", "/").includes(APP_SRC);

const isTestFile = (filename) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename.replaceAll("\\", "/"));

const calleeName = (node) => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
};

const unwrap = (node) => {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "ChainExpression")
  ) {
    current = current.expression;
  }
  return current;
};

const propertyKey = (prop) => {
  if (prop.type !== "Property" || prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return prop.key.value;
  return null;
};

const isInfinity = (node) => {
  const value = unwrap(node);
  return value?.type === "Identifier" && value.name === "Infinity";
};

const isAlways = (node) => {
  const value = unwrap(node);
  return value?.type === "Literal" && value.value === "always";
};

const noQueryClientDefaultOverrides = {
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (!isAppSrc(filename) || isTestFile(filename)) return {};

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
};

export { noQueryClientDefaultOverrides };

export default {
  meta: { name: "pie-query" },
  rules: {
    "no-query-client-default-overrides": noQueryClientDefaultOverrides,
  },
};
