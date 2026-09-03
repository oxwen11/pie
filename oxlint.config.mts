import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import vitest from "ultracite/oxlint/vitest";

import { deferredUltraciteRules, deferredVitestUltraciteRules } from "./oxlint.deferred.mts";

const pieIgnorePatterns = [
  "**/routeTree.gen.ts",
  ".conductor",
  "**/dist/**",
  "**/node_modules/**",
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".factory/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
];

/**
 * Slice 1 of the Ultracite adoption: extend the official oxlint presets and
 * keep the current pie rule surface. New Ultracite rules stay off in
 * `oxlint.deferred.mts` until a later PR deletes that group and fixes hits.
 *
 * Later slices (one concern each): hooks + type-aware exhaustiveness →
 * barrels / await-in-loop / derived effects → any / unsafe / strict boolean
 * → remaining pedantic/style → oxfmt 80-col → optional js-plugins.
 */
export default defineConfig({
  extends: [core, react, vitest],
  ignorePatterns: [...new Set([...core.ignorePatterns, ...pieIgnorePatterns])],
  options: {
    typeAware: true,
  },
  categories: {
    correctness: "error",
    suspicious: "warn",
  },
  plugins: ["vitest"],
  jsPlugins: [
    {
      name: "pie",
      specifier: "@getpie/oxlint/pie",
    },
    {
      name: "pie-boundaries",
      specifier: "@getpie/oxlint/pie-boundaries",
    },
    {
      name: "pie-query",
      specifier: "@getpie/oxlint/pie-query",
    },
    "eslint-plugin-react-you-might-not-need-an-effect",
    {
      name: "anti-slop",
      specifier: "@getpie/oxlint/anti-slop",
    },
    {
      name: "anti-slop-effect",
      specifier: "@getpie/oxlint/anti-slop-effect",
    },
  ],
  rules: {
    ...deferredUltraciteRules,

    // Pie-specific plugins and options. These win over Ultracite.
    "import/no-unassigned-import": [
      "error",
      {
        allow: [
          "**/*.css",
          "@orpc/experimental-effect/extensions/effect",
          "@orpc/experimental-effect/extensions/input-output",
          "zod/compile",
        ],
      },
    ],
    eqeqeq: [
      "error",
      "always",
      {
        null: "ignore",
      },
    ],
    "pie/node-import-style": "error",
    "pie/no-restricted-disable": "error",
    "pie-boundaries/feature-no-route-match": "error",
    "pie-boundaries/feature-no-cross-import": "error",
    "pie-boundaries/app-no-server-import": "error",
    "pie-query/no-query-client-default-overrides": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "off",
    "anti-slop/no-shape-in-symbol-names": "off",
    "anti-slop/no-unknown-parameters": "off",
    "anti-slop/no-unknown-returns": "off",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "off",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    "anti-slop-effect/no-service-constructor-imports": "off",
    "react/exhaustive-deps": [
      "error",
      {
        additionalHooks: "^use(Effect|Callback|Memo|LayoutEffect|ImperativeHandle)$",
      },
    ],
    "jsx-a11y/role-supports-aria-props": "warn",
    "jsx-a11y/no-autofocus": "off",
    "jsx-a11y/prefer-tag-over-role": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "react/react-in-jsx-scope": "off",
    "unicorn/no-empty-file": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/no-array-sort": "off",
    "oxc/no-async-endpoint-handlers": "off",
    "react/iframe-missing-sandbox": "off",
    "react/purity": "off",
    "react/set-state-in-effect": "off",
    "react/exhaustive-effect-dependencies": "off",
    "react/immutability": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/consistent-return": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "promise/always-return": "off",
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      },
    ],
    "no-underscore-dangle": [
      "warn",
      {
        allow: ["_tag", "_values"],
      },
    ],
    "react-you-might-not-need-an-effect/no-derived-state": "error",
    "react-you-might-not-need-an-effect/no-chain-state-updates": "error",
    "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change": "error",
    "react-you-might-not-need-an-effect/no-reset-all-state-on-prop-change": "error",
    "react-you-might-not-need-an-effect/no-initialize-state": "error",
    "react-you-might-not-need-an-effect/no-event-handler": "error",
    "react-you-might-not-need-an-effect/no-pass-data-to-parent": "error",
    "react-you-might-not-need-an-effect/no-pass-live-state-to-parent": "error",
    "react-you-might-not-need-an-effect/no-external-store-subscription": "error",

    // Ultracite turns these off; pie already enforces them.
    "import/no-anonymous-default-export": "error",
    "import/no-commonjs": "error",
    "import/no-dynamic-require": "error",
    "react/no-unknown-property": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-var-requires": "error",
    "unicorn/explicit-length-check": "error",
    "unicorn/no-process-exit": "error",
    "unicorn/prefer-string-raw": "error",
    "unicorn/text-encoding-identifier-case": "error",
    "typescript/return-await": "error",
    "vitest/valid-title": "error",
    "react/forward-ref-uses-ref": "error",
  },
  overrides: [
    {
      files: [
        "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx}",
        "**/__tests__/**/*.{ts,tsx,js,jsx}",
      ],
      rules: deferredVitestUltraciteRules,
    },
    {
      files: [
        "packages/ui/src/components/**",
        "packages/ui/src/hooks/**",
        "packages/ui/src/ai-elements/**",
      ],
      rules: {
        "react-you-might-not-need-an-effect/no-derived-state": "off",
        "react-you-might-not-need-an-effect/no-chain-state-updates": "off",
        "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change": "off",
        "react-you-might-not-need-an-effect/no-reset-all-state-on-prop-change": "off",
        "react-you-might-not-need-an-effect/no-initialize-state": "off",
        "react-you-might-not-need-an-effect/no-event-handler": "off",
        "react-you-might-not-need-an-effect/no-pass-data-to-parent": "off",
        "react-you-might-not-need-an-effect/no-pass-live-state-to-parent": "off",
        "react-you-might-not-need-an-effect/no-external-store-subscription": "off",
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-conditional-empty-object-spread": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-module-mocking": "off",
        "anti-slop/no-object-parameters": "off",
        "anti-slop/no-unknown-type-aliases": "off",
        "anti-slop/no-widen-then-assert": "off",
        "react/jsx-no-useless-fragment": "off",
        "typescript/no-floating-promises": "off",
        "typescript/unbound-method": "off",
        "typescript/no-useless-default-assignment": "off",
        "unicorn/prefer-string-slice": "off",
        "unicorn/explicit-length-check": "off",
        "typescript/no-misused-promises": "off",
        "react/jsx-no-constructed-context-values": "off",
        "react/no-object-type-as-default-prop": "off",
        "typescript/use-unknown-in-catch-callback-variable": "off",
        "typescript/prefer-reduce-type-parameter": "off",
        "no-promise-executor-return": "off",
      },
    },
    {
      files: ["**/*.cjs"],
      rules: {
        "import/no-commonjs": "off",
        "typescript/no-require-imports": "off",
        "typescript/no-var-requires": "off",
      },
    },
  ],
});
