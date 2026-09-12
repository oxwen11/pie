# Explaining and configuring rules

Explain React Doctor rules and edit `doctor.config.*` safely. Use this when a user
wants to understand a rule or change which rules run — not for fixing diagnostics
(that is the main `react-doctor` skill / `/doctor`).

Triggers: "why did this rule fire", "I disagree with this rule", "turn this rule off",
"stop flagging X", "too noisy", "disable design rules".

Run every command below from `apps/app` with the workspace CLI (0.9.14), not
`npx react-doctor@latest`.

## In this repository

Root `doctor.config.json` is the shared severity map for `@getpie/app` and
`@getpie/desktop`. Read [strict-value.md](strict-value.md) before changing it.
Do not set `projects` in the root config (that breaks per-package `pnpm doctor`).
Do not add Next.js / React Native / retired design IDs "for completeness."
Do not disable a strict SPA rule to land a PR — inline
`react-doctor-disable-next-line` is last resort and needs a comment naming the
invariant the rule cannot see.

## Workflow

1. Identify the rule key from the diagnostic (e.g. `react-doctor/no-array-index-as-key`).
2. Explain it before changing anything:

```bash
pnpm exec react-doctor rules explain react-doctor/no-array-index-as-key
pnpm exec react-doctor why src/features/chat/components/chat-input-queue.tsx:63
```

3. Pick the narrowest control that matches the user's intent (see decision guide).
4. Apply it with a `rules` subcommand (edits `doctor.config.json` or `package.json#reactDoctor` in place, preserving other fields and formatting).
5. Validate the change did what they wanted:

```bash
pnpm exec react-doctor --yes --verbose --scope changed
```

## Commands

```bash
pnpm exec react-doctor rules list                         # every rule + its effective severity
pnpm exec react-doctor rules list --configured            # only what your config changed
pnpm exec react-doctor rules list --category Performance   # filter by category
pnpm exec react-doctor rules list --tag design             # filter by tag
pnpm exec react-doctor rules explain <rule>               # why it matters + how to configure
pnpm exec react-doctor why <file:line>                    # why it fired at this location
pnpm exec react-doctor rules disable <rule>               # rule never runs
pnpm exec react-doctor rules enable <rule>                # turn back on at its recommended severity
pnpm exec react-doctor rules set <rule> warn              # off | warn | error
pnpm exec react-doctor rules category "React Native" off   # whole category
pnpm exec react-doctor rules ignore-tag design            # skip a rule family (design, test-noise, …)
pnpm exec react-doctor rules unignore-tag design
```

Rule references accept the full key (`react-doctor/no-danger`), the bare id (`no-danger`), or a legacy key (`react/no-danger`).

## Decision guide

Match the control to the intent — prefer the narrowest one:

- **User disagrees with one rule / it's a false positive for them** → `rules disable <rule>` (sets `rules.<key> = "off"`; the rule stops running everywhere). This is the default for "I don't want this rule" — except for the strict SPA set in [strict-value.md](strict-value.md), which needs a comment or a config note, not a silent off.
- **Rule is fine but wrong severity** → `rules set <rule> warn` or `rules set <rule> error`.
- **A disabled-by-default rule they want on** → `rules enable <rule>`.
- **A whole area is unwanted** (e.g. all React Native rules) → `rules category "<Category>" off`. The CLI only accepts Security / Bugs / Performance / Accessibility / Maintainability — "React Native" is not a category name here.
- **A behavioral family is noisy** (`design`, `test-noise`, `migration-hint`) → `rules ignore-tag <tag>`. Prefer `react-doctor design` for a one-off UI audit instead of enabling design tags in the health scan.
- **Keep it locally but hide from PR comment / score / CI gate only** → do NOT disable. Edit `surfaces` in your config (`surfaces.prComment.excludeRules`, `surfaces.score.excludeTags`, `surfaces.ciFailure.excludeCategories`). The rule still shows in local `cli` output.
- **Restore test or story findings to production health** → set `surfaces.score.includeFileContexts` or `surfaces.ciFailure.includeFileContexts` to `["test"]`, `["story"]`, or both. Other surface exclusions still apply.

How the layers combine: `ignore.tags` disables every rule carrying that tag **before** linting, so a tagged rule stays off even if `rules`/`categories` set it to `warn`/`error` (a rule-level override cannot re-enable a tag-ignored rule). For rules that aren't tag-disabled, `rules` overrides `categories` overrides the rule's default. `surfaces` is visibility-only and never changes whether a rule runs.

## Config shape

Config lives in `doctor.config.ts` (or `.js`/`.mjs`/`.cjs`/`.json`/`.jsonc`/`.json5`), or the `reactDoctor` key in `package.json`. This repo uses root `doctor.config.json` (JSON5 comments allowed). The `rules` commands edit whichever exists — TS/JS edits preserve formatting (via magicast) — and create `doctor.config.json` when none does, stamping `$schema`:

```ts
// doctor.config.ts
export default {
  rules: { "react-doctor/no-array-index-as-key": "off" },
  categories: { Performance: "warn" },
  ignore: { tags: ["design"] },
};
```

## Educating the user

When explaining a rule, lead with the "Why it matters" guidance from `rules explain` and, when they want depth, the per-rule recipe at `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md`. Only after they understand it should you offer to disable it — many "bad" rules are catching real issues.
