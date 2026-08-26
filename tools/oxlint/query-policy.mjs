// Enforces TanStack Query conventions in .agents/rules/frontend-state.md:
// call useQuery at the consumer, and do not repeat QueryClient defaults.

const APP_SRC = "apps/app/";
const QUERY_HOOKS = new Set([
  "useQuery",
  "useQueries",
  "useSuspenseQuery",
  "useSuspenseQueries",
  "useInfiniteQuery",
]);
const COMPANION_HOOKS = new Set(["useRouteContext", "useCallback", "useMemo"]);

const isAppSrc = (filename) => filename.replaceAll("\\", "/").includes(APP_SRC);

const isTestFile = (filename) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename.replaceAll("\\", "/"));

const isHookName = (name) => typeof name === "string" && /^use[A-Z]/.test(name);

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

const noThinUseQueryHook = {
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (!isAppSrc(filename) || isTestFile(filename)) return {};

    const functions = [];
    const callCounts = new Map();
    const stack = [];
    let declaratorName = null;

    const enterFunction = (node, name) => {
      stack.push({ node, name, hooks: [] });
    };

    const exitFunction = () => {
      const current = stack.pop();
      if (current !== undefined) functions.push(current);
    };

    return {
      VariableDeclarator(node) {
        declaratorName = node.id.type === "Identifier" ? node.id.name : null;
      },
      "VariableDeclarator:exit"() {
        declaratorName = null;
      },
      FunctionDeclaration(node) {
        enterFunction(node, node.id?.name ?? null);
      },
      "FunctionDeclaration:exit"() {
        exitFunction();
      },
      FunctionExpression(node) {
        enterFunction(node, node.id?.name ?? declaratorName);
      },
      "FunctionExpression:exit"() {
        exitFunction();
      },
      ArrowFunctionExpression(node) {
        enterFunction(node, declaratorName);
      },
      "ArrowFunctionExpression:exit"() {
        exitFunction();
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === null) return;
        callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
        const current = stack.at(-1);
        if (current !== undefined && isHookName(name)) current.hooks.push(name);
      },
      "Program:exit"() {
        for (const fn of functions) {
          if (!isHookName(fn.name)) continue;
          const queryHooks = fn.hooks.filter((hook) => QUERY_HOOKS.has(hook));
          if (queryHooks.length !== 1) continue;
          const extra = fn.hooks.filter(
            (hook) => !QUERY_HOOKS.has(hook) && !COMPANION_HOOKS.has(hook),
          );
          if (extra.length > 0) continue;
          if ((callCounts.get(fn.name) ?? 0) >= 2) continue;

          context.report({
            node: fn.node.id ?? fn.node,
            message:
              "Do not wrap a bare useQuery in a hook. Call useQuery at the consumer. A hook is justified only when it owns extra state, a mutation, or a multi-query policy.",
          });
        }
      },
    };
  },
};

export { noQueryClientDefaultOverrides, noThinUseQueryHook };

export default {
  meta: { name: "pie-query" },
  rules: {
    "no-query-client-default-overrides": noQueryClientDefaultOverrides,
    "no-thin-use-query-hook": noThinUseQueryHook,
  },
};
