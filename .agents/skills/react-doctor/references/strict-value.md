# Strict rules that earn their keep

React Doctor 0.9.14 ships hundreds of checks with many off by default. This
repo turns **all of them on at error**. Next.js / React Native / Ink IDs stay
listed; they are inert here because this is a Vite SPA — do not turn them off
"because we are not Next." Retired IDs (`prefer-explicit-variants`,
`no-many-boolean-props`, …) report nothing even when listed.

Config lives in the repo-root `doctor.config.json` (inherited by `@getpie/app`
and `@getpie/desktop`). `packages/ui` layers `only-export-components: off` on
top because those files are vendored from the coss registry.

CI and `pnpm doctor` use `--blocking warning`. A warning is a failed check.
Do not `rules set <rule> warn` to land a PR.

## The only rules that stay off

These three fight the stack. Anything else that fires must be fixed in code.

| Rule | Why it stays off |
| --- | --- |
| `react-in-jsx-scope` | React 19 automatic JSX runtime. Adding `import React` makes an unused import that oxlint then rejects. |
| `jsx-props-no-spreading` | `.agents/rules/ui-components.md` requires spreading props **last** on the wrapped element so callers can override defaults. |
| `js-cache-property-access` | The detector cannot tell a stable lookup from a value that must be re-read (`abort.signal.aborted`, layout, time). Caching those changes behavior. Hoist a local `const` yourself when the value is actually stable. |

Do not add a fourth `off` to land a PR. Inline
`react-doctor-disable-next-line` is the last resort and needs a comment
naming the invariant the rule cannot see.

## Write this way on purpose

| Doctor rule | Practice to follow | Skill / rule |
| --- | --- | --- |
| `no-barrel-import` | Import the module, not a barrel (`lucide-react/icons/…`, `@getpie/ui/…` subpaths) | `vercel-react-best-practices` `bundle-barrel-imports` |
| `no-usememo-simple-expression` | Do not wrap a cheap primitive in `useMemo` | `rerender-simple-expression-in-memo` |
| `rendering-hoist-jsx` | Hoist static JSX (especially SVG) out of the component | `rendering-hoist-jsx` |
| `prefer-module-scope-pure-function` / `prefer-module-scope-static-value` | Stable pure helpers and constants live at module scope | same skill, hoist rules |
| `js-combine-iterations` / `js-length-check-first` / `js-flatmap-filter` | One pass, length before expensive compare | `js-*` rules |
| `no-impure-call-at-module-scope` | No work with side effects at import time | `.agents/rules/frontend-state.md` (`pie/no-let`) |
| `prefer-useReducer` | Related fields that update together → one reducer, not a handful of `useState` | composition patterns |
| `jsx-max-depth` | Extract nested JSX into a named component | `ui-components.md` |
| `rendering-svg-precision` | Shorten SVG path precision | `rendering-svg-precision` |
| `zod-v4-prefer-top-level-string-formats` | Zod 4 top-level string formats (`z.email()`, not `z.string().email()`) | Zod 4 docs |
| `unused-file` / `unused-export` / `unused-type` / `unused-dependency` / `unused-dev-dependency` / `circular-dependency` | Delete or unexport dead graph nodes; exported `*Props` that nothing imports yet still count — unexport until a caller exists | `.agents/rules/ui-components.md` |
| `agent-tool-capability-risk` / `mcp-tool-capability-risk` | Inventory is a gate. Confirm the tool's policy matches the finding, then fix the declaration or the code | — |

`buckets.compiler-cleanup` is `error` so that if React Compiler is turned on,
redundant manual memoization is a gate, not a suggestion.

Design-tagged rules are error and **included** in the health scan
(`surfaces.*.includeTags: ["design"]`). Fix the code (padding shorthand,
`motion-safe:` animations, `group-focus-within` with hover reveals). Do not
`ignore-tag design` to land a PR.

## Sibling commands (not CI)

`design` and `scan` ship with 0.9.14. They are not separate enablement switches.

- UI composition / typography / motion: `pnpm exec react-doctor design --verbose` from `apps/app`, then `.agents/skills/web-design-guidelines`.
- A slow interaction: `/performance` → `pnpm exec react-doctor scan http://localhost:4190/ --format json`.
- A roadmap rather than a fix-it-now pass: `/improve-react` (read-only; writes `plans/`).
- Why this line fired: `pnpm exec react-doctor why <file:line>`.

## How to fix a diagnostic

1. `pnpm exec react-doctor rules explain <rule>` from `apps/app` (or `why <file:line>`)
2. Fetch `https://www.react.doctor/prompts/rules/react-doctor/<id>.md`
3. Apply the practice in the table, then re-run
   `pnpm exec react-doctor --yes --verbose --scope changed --blocking warning` from `apps/app`
   (or `pnpm doctor`).

Do not `rules disable` an enabled rule to land a PR. Inline
`react-doctor-disable-next-line` is the last resort and needs a comment
naming the invariant the rule cannot see.
