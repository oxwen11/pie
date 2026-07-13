---
name: shadcn-triage
description: shadcn CLI/theme update triage for packages/ui, before committing. Use when the user runs `shadcn add`/`diff`, pastes a new theme into `packages/ui/src/globals.css`, or asks whether a bulk packages/ui diff is ready to commit.
---

# shadcn triage

`packages/ui` vendors shadcn components into a Vite monorepo with a hand-tuned `globals.css` — the CLI and registry themes don't know either fact. Every update needs the same triage before it's commit-ready. Each step below is independently checkable; work through all of them.

## 1. New dependencies must resolve outside Next.js

shadcn registry items sometimes pull in a `next/font`-only package (its `exports` map has no `.`, only `next`-specific subpaths like `./font`). This repo has no `next` dependency, so a bare `@import "<pkg>"` for such a font resolves nowhere — and it fails at the Tailwind CSS build step, not typecheck.

Self-host fonts via `@fontsource-variable/<font>` instead — the existing pattern for Geist, Geist Mono, and Inter. Diff `package.json`/`globals.css` for any newly-added font import; if it isn't `@fontsource-variable/*`, swap it and drop the extra dependency (`pnpm install` after editing `package.json` to sync the lockfile).

Done: `pnpm --filter web build` completes past the `@tailwindcss/vite` step.

## 2. Font-family strings must match the actual @font-face

`@fontsource-variable/*` registers `font-family: '<Name> Variable'` — check the installed package's `index.css` (`node_modules/.pnpm/@fontsource-variable+<pkg>@*/node_modules/@fontsource-variable/<pkg>/index.css`) rather than assuming. A `--font-sans`/`--font-mono`/`--font-heading` value that says `'Inter'` instead of `'Inter Variable'` doesn't error anywhere — build, typecheck, and lint all stay green — it just silently falls back to a system font.

Done: `grep -oE "font-family:[^;]*" apps/web/dist/assets/*.css | sort -u` shows every theme font resolving to its `<Name> Variable` form after a build.

## 3. `@theme inline` merges leave duplication and dead vars

`@theme inline` re-exports `:root`/`.dark` values via `var(--x, fallback)` (color tokens alias as `--color-x: var(--x)`). A theme paste that hardcodes a literal straight into `@theme inline` breaks that single source of truth and orphans the `:root` definition instead of updating it — fix the value at `:root`, don't hardcode `@theme inline`.

Also watch for exact-duplicate or self-referential lines the merge may have introduced, e.g. `--code-foreground: var(--code-foreground);` sitting beside the correctly-prefixed `--color-code-foreground: var(--code-foreground);`, or a selector block repeated twice.

Done: read every changed hunk in `@theme inline`, `:root`, and `.dark` — no property name repeats within the same block, no `--x: var(--x)` self-reference, and no hardcoded literal where a `var(...)` reference used to be.

## 4. a11y regressions on interactive wrapper elements

Some components forward focus/click through a plain `<div>`/`<span>` that carries an event handler (`onMouseDown`, `onClick`) alongside a `role` that makes it valid for assistive tech. A registry update can drop the `role` while keeping the handler. Run `oxlint packages/ui/src` after the update; a new `jsx-a11y/no-static-element-interactions` **error** (pre-existing `no-shadow`/`no-unstable-nested-components` warnings are unrelated noise) means a `role` was stripped — diff that hunk and restore it.

Done: `oxlint packages/ui/src` reports no new errors beyond the pre-existing warning set.

## 5. Format and re-verify

Registry pastes usually skip the repo's formatter — braces collapsed onto declaration lines, missing trailing newlines. Run `pnpm format`, then the full gate:

```bash
pnpm --filter @vibest/ui typecheck
pnpm --filter web typecheck
oxlint packages/ui/src
pnpm --filter web build
```

Done: all four are clean before the diff is offered up for commit.
