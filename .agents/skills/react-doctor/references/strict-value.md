# Strict rules that earn their keep

React Doctor 0.9.14 retired low-signal style/migration IDs and made 26
cleanup checks opt-in. This repo opts back in only where a finding maps to
a practice we already teach — so agents fix the code instead of silencing
the diagnostic.

Config lives in the repo-root `doctor.config.json` (inherited by `@getpie/app`
and `@getpie/desktop`). `packages/ui` layers `only-export-components: off` on
top because those files are vendored from the coss registry.

## Do not re-enable

Retired IDs (`prefer-explicit-variants`, `no-many-boolean-props`,
`js-early-exit`, `js-tosorted-immutable`, `rendering-usetransition-loading`,
design/typography rules, React Native `setNativeProps` / Reanimated
migrations, …) report nothing even if listed. Follow
`.agents/rules/ui-components.md` and
`.agents/skills/vercel-composition-patterns` for API shape; do not expect
Doctor to police boolean-prop counts.

Skip Next.js RSC, `next/image`, Firebase, and BaaS rules — this is a Vite
SPA. Do not add them "for completeness."

`js-cache-property-access` stays off. 0.9.14 made it opt-in because the
detector cannot tell a stable lookup from a value that must be re-read
(`abort.signal.aborted`, layout, time). Caching those changes behavior.
Hoist a local `const` yourself when the value is actually stable.

## Enabled at error — write this way on purpose

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
| `unused-file` / `unused-export` / `unused-dependency` / `unused-dev-dependency` / `circular-dependency` | Delete or wire up dead graph nodes; full scans only | — |

`buckets.compiler-cleanup` is `error` so that if React Compiler is turned on,
redundant manual memoization is a gate, not a suggestion.

## Enabled at warn — review, do not rubber-stamp

`unused-type` is warn because exported `*Props` / options / return types are
the component API (`.agents/rules/ui-components.md`) even when nothing
imports them yet. Unexport a type only when it is module-private.

`agent-tool-capability-risk` and `mcp-tool-capability-risk` inventory
capabilities. They are not proof of a hole. When they fire on a tool you
touched, read the finding, confirm the policy, and leave the warn in place
unless the code is wrong.

## Sibling commands (not CI)

`design` and `scan` ship with 0.9.14. They are not CI gates.

- UI composition / typography / motion: `pnpm exec react-doctor design --verbose` from `apps/app`, then `.agents/skills/web-design-guidelines`. Design-tagged rules stay off in the health scan on purpose.
- A slow interaction: `/performance` → `pnpm exec react-doctor scan http://localhost:4190/ --format json`.
- A roadmap rather than a fix-it-now pass: `/improve-react` (read-only; writes `plans/`).
- Why this line fired: `pnpm exec react-doctor why <file:line>`.

## How to fix a diagnostic

1. `pnpm exec react-doctor rules explain <rule>` from `apps/app` (or `why <file:line>`)
2. Fetch `https://www.react.doctor/prompts/rules/react-doctor/<id>.md`
3. Apply the practice in the table, then re-run
   `pnpm exec react-doctor --yes --verbose --scope changed` from `apps/app`
   (or `pnpm doctor`).

Do not `rules disable` a strict rule to land a PR. Inline
`react-doctor-disable-next-line` is the last resort and needs a comment
naming the invariant the rule cannot see.
