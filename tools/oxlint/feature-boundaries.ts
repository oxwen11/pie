import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Enforces frontend-state and package boundary rules documented in
// .agents/rules/frontend-state.md and .agents/rules/architecture.md.

const FEATURES_ROOT = "apps/app/src/features/";
const APP_ROOT = "apps/app/";

const featureNameFromFilename = (filename: string): string | null => {
  const normalized = filename.replaceAll("\\", "/");
  const idx = normalized.indexOf(FEATURES_ROOT);
  if (idx === -1) return null;
  const rest = normalized.slice(idx + FEATURES_ROOT.length);
  return rest.split("/")[0] ?? null;
};

const isAppFile = (filename: string): boolean => filename.replaceAll("\\", "/").includes(APP_ROOT);

const exportName = (imported: ESTree.ModuleExportName): string =>
  imported.type === "Identifier" ? imported.name : imported.value;

const crossFeatureImport = (source: string, featureName: string): string | null => {
  const match = source.match(/^@\/features\/([^/]+)/);
  const other = match?.[1];
  if (other === undefined || other === featureName) return null;
  return other;
};

const featureNoRouteMatchRule = defineRule({
  create(context) {
    const featureName = featureNameFromFilename(context.filename);
    if (featureName === null) return {};

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@tanstack/react-router") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            exportName(specifier.imported) === "useMatch"
          ) {
            context.report({
              node: specifier,
              message:
                "Features must not read route identity via useMatch. Derive session/project context from props or panel handles at the composition root instead.",
            });
          }
        }
      },
    };
  },
});

const featureNoCrossImportRule = defineRule({
  create(context) {
    const featureName = featureNameFromFilename(context.filename);
    if (featureName === null) return {};

    return {
      ImportDeclaration(node) {
        const other = crossFeatureImport(node.source.value, featureName);
        if (other === null) return;
        context.report({
          node: node.source,
          message: `Features must not import each other. Move shared needs to a composition root instead of importing from @/features/${other}.`,
        });
      },
    };
  },
});

const appNoServerImportRule = defineRule({
  create(context) {
    if (!isAppFile(context.filename)) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === "@getpie/server" || source.startsWith("@getpie/server/")) {
          context.report({
            node: node.source,
            message:
              "apps/app must not import @getpie/server. Use @getpie/client and @getpie/contract instead.",
          });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "pie-boundaries" },
  rules: {
    "feature-no-route-match": featureNoRouteMatchRule,
    "feature-no-cross-import": featureNoCrossImportRule,
    "app-no-server-import": appNoServerImportRule,
  },
});
