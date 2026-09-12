---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user types `/doctor`, asks to scan, triage, or clean up React diagnostics. Covers lint, accessibility, bundle size, architecture. Includes a regression check and a full local-triage workflow that fetches the canonical playbook.
version: "1.2.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

This repo pins a **strict opt-in set** in `doctor.config.json` (React Doctor 0.9.14+). Default scans only report proven defects; we re-enable the cleanup and graph checks that map to practices we already teach. Read [references/strict-value.md](references/strict-value.md) before disabling a rule or adding a Next.js / React Native check. CI still fails on error-severity findings only.

## After making React code changes:

Run `pnpm exec react-doctor --yes --verbose --scope changed` from `apps/app` (CLI 0.9.14, same as CI) and check the score did not regress.

If the score dropped, fix the regressions before committing.

## For general cleanup or code improvement:

Run `pnpm exec react-doctor --yes --verbose` from `apps/app` (the default `--scope full`) to scan the full codebase. Fix issues by severity — errors first, then warnings. Prefer the workspace CLI over `npx react-doctor@latest` so the scan matches `doctor.config.json` and the CI pin.

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

When the user wants to understand a rule, disagrees with one, or wants to disable / tune which rules run (not fix code), read [references/explain.md](references/explain.md) and follow it. Start with `pnpm exec react-doctor rules explain <rule>` from `apps/app`, then apply the narrowest control via `pnpm exec react-doctor rules disable|set|category|ignore-tag …`, which edits `doctor.config.json` (or `package.json#reactDoctor`).

## Command

```bash
pnpm exec react-doctor --yes --verbose --scope changed
```

| Flag              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `.`               | Scan current directory                                           |
| `--verbose`       | Show affected files and line numbers per rule                    |
| `--scope changed` | Only report issues introduced vs the base branch (default: full) |
| `--scope lines`   | Only report issues on the changed lines                          |
| `--score`         | Output only the numeric score                                    |
