---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user types `/doctor`, asks to scan, triage, or clean up React diagnostics. Covers lint, accessibility, bundle size, architecture. Includes a regression check, a focused `design` audit, a runtime `scan`, and a full local-triage workflow that fetches the canonical playbook.
version: "1.4.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

This repo pins CLI **0.9.14**. Root `doctor.config.json` turns **every** shipped rule on at **error**. Three rules stay off because they are wrong on this stack — read [references/strict-value.md](references/strict-value.md) before adding a fourth. CI and `pnpm doctor` use `--blocking warning`: a warning is a failed check.

Prefer the workspace CLI over `npx react-doctor@latest` so the scan matches the config and the CI pin. Run it from `apps/app`:

```bash
pnpm exec react-doctor --yes --verbose --scope changed --blocking warning
```

Sibling skills shipped with the same CLI: `performance` (`/performance`, runtime `scan`) and `improve-react` (read-only audit and plans). Do not install `improve-threejs` — this app is not Three.js / R3F. Do not run `react-doctor install --yes`: it copies skills into every agent dir (breaking the `.agents` → `.cursor` symlinks) and can add a `doctor` script to packages that should not own the scanner.

## After making React code changes:

Run `pnpm exec react-doctor --yes --verbose --scope changed --blocking warning` from `apps/app` and check the score did not regress.

If the score dropped, fix the regressions before committing.

## For general cleanup or code improvement:

Run `pnpm exec react-doctor --yes --verbose --blocking warning` from `apps/app` (the default `--scope full`) to scan the full codebase. Fix every finding — warnings fail CI. Do not silence a finding by turning the rule off unless it is one of the three documented stack mismatches.

## For a focused UI design audit:

Run `pnpm exec react-doctor design --verbose` from `apps/app`. This selects only design-tagged UI composition, typography, interaction, accessibility, and motion rules. The same rules also run in the default health scan (`surfaces.*.includeTags: ["design"]`); `design` is the focused pass, not a separate enablement switch.

Pair findings with `.agents/skills/web-design-guidelines`. Design-tagged rules are error in the root config, same as the rest.

## For runtime performance problems:

Use the `performance` skill (`/performance`). From an interactive terminal, with Vite on `:4190`:

```bash
pnpm exec react-doctor scan http://localhost:4190/ --format json
```

React Doctor opens an isolated system Chrome profile, records a DevTools trace while the user reproduces the slow interaction, and flashes purple outlines with component names as React renders. It stops when they press Enter. Read the structured summary first, then inspect the returned local `.json.gz` trace for CPU, browser, and React component evidence.

If the user needs their authenticated browser state, use `--cdp <remote-debugging-url>`. This requires Chrome to already be running with remote debugging. Never ask for cookies or copy the user's browser profile. Treat the trace as sensitive local application data and never upload it without explicit permission.

Open **the Vite URL** (`http://localhost:4190/`), not the pie server on `:4180` and not the daemon on `:4000`. See `.agents/skills/verify`.

## /doctor — full local triage workflow

When the user types `/doctor`, says "run react doctor", or asks for a full triage / cleanup pass (not just a regression check), fetch the canonical local-triage playbook and follow every step in it:

```bash
curl --fail --silent --show-error \
  --header 'Cache-Control: no-cache' \
  https://www.react.doctor/prompts/react-doctor-agent.md
```

The playbook is the single source of truth — a scan → filter → triage → fix → validate loop that edits the working tree directly (never commits, never opens PRs). Updating the prompt at its source updates every agent on its next fetch — no skill reinstall needed.

Pair it with the matching per-rule prompts at `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md` (fetched on demand inside the playbook) so each fix uses the canonical, reviewer-tested recipe.

## Configuring or explaining rules

When the user wants to understand a rule, disagrees with one, or wants to disable / tune which rules run (not fix code), read [references/explain.md](references/explain.md) and follow it. Start with `pnpm exec react-doctor rules explain <rule>` from `apps/app`, or `pnpm exec react-doctor why <file:line>` when the question is a specific diagnostic. Then apply the narrowest control via `pnpm exec react-doctor rules disable|set|category|ignore-tag …`, which edits `doctor.config.json` (or `package.json#reactDoctor`).

Do not `rules disable` a listed rule from [references/strict-value.md](references/strict-value.md) to land a PR. Fix the code.

## Command

```bash
pnpm exec react-doctor --yes --verbose --scope changed --blocking warning
```

| Flag / command    | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `.`               | Scan current directory                                           |
| `--verbose`       | Show affected files and line numbers per rule                    |
| `--scope changed` | Only report issues introduced vs the base branch (default: full) |
| `--scope lines`   | Only report issues on the changed lines                          |
| `--score`         | Output only the numeric score                                    |
| `--blocking warning` | Fail the command on warning or error (repo default)           |
| `design`          | Run only the focused UI design diagnostics                       |
| `scan <url>`      | Record a Chrome interaction trace (see `performance`)            |
| `why <file:line>` | Explain why a rule fired (or a suppression did not apply)        |
