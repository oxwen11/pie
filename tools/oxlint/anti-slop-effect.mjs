// tools/oxlint/anti-slop/effect/index.ts
import { eslintCompatPlugin } from "@oxlint/plugins";

// tools/oxlint/anti-slop/effect/rules/no-service-constructor-imports.ts
import { defineRule } from "@oxlint/plugins";
var SERVICE_CONSTRUCTOR_NAME = /^make[A-Z]/u;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
function isProjectLocalImport(source) {
  return source.startsWith("./") || source.startsWith("../");
}
function getImportedName(specifier) {
  if (specifier.imported.type === "Identifier") return specifier.imported.name;
  return specifier.imported.value;
}
var noServiceConstructorImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow project-local make<CapabilityName> imports outside test and spec files."
    },
    messages: {
      serviceConstructorImport: 'Do not import Effect service constructor "{{name}}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.'
    }
  },
  create(context) {
    const isTestFile = TEST_FILE.test(context.filename.replaceAll("\\", "/"));
    return {
      ImportDeclaration(node) {
        if (isTestFile || !isProjectLocalImport(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const importedName = getImportedName(specifier);
          if (!SERVICE_CONSTRUCTOR_NAME.test(importedName)) continue;
          context.report({
            node: specifier,
            messageId: "serviceConstructorImport",
            data: { name: importedName }
          });
        }
      }
    };
  }
});

// tools/oxlint/anti-slop/effect/index.ts
var antiSlopEffectPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop-effect" },
  rules: {
    "no-service-constructor-imports": noServiceConstructorImportsRule
  }
});
var index_default = antiSlopEffectPlugin;
export {
  index_default as default
};
