---
name: fallow
description: Periodic codebase graph scan (duplication, complexity/health, dead code, PR-delta audit) via on-demand npx. Use when the user types /fallow, asks to scan dupes/health/unused, or wants a periodic hygiene look — not on every commit.
---

# fallow

Optional local [fallow](https://github.com/fallow-rs/fallow) scan. **No install.**
Pin **3.27.0**. Repo-root `.fallowrc.json` loads automatically. oxlint +
react-doctor stay the unused / circular / boundary **gates**. This skill does
not fail CI and is not part of `pnpm check`.

Do not add `fallow` to `package.json`, `mise.toml`, or `quality.yml`. Do not
run `fallow init --agents` or `fallow hooks install` (they write extra agent
files and can break `.agents` → `.cursor` symlinks). Do not add `pie fallow`
— `pie` is a daemon client (`.agents/rules/cli.md`).

## Command

From the repo root. Exit **0 and 1 both mean the run succeeded** (1 = findings).
Exit **2** is a real error. Do not wrap with `|| true`.

```bash
npx --yes fallow@3.27.0 <subcommand>
```

| Subcommand | When | Notes |
| --- | --- | --- |
| `audit` | **Default / periodic.** After a slice, or when asked to “scan periodically.” | New-finding gate vs the merge base / `--changed-since`. Do **not** pass `--gate all`. |
| `dupes` | Looking for copy-paste | Unique vs Doctor. Files/Review/PR adapters and `pi-loop` ↔ `server` cron are known real clones. |
| `health --score` | Complexity / hotspots | Letter grade + CRAP. Ignore vendored `packages/ui/src/components/drawer.tsx`. |
| `dead-code` | Unused-graph curiosity | Overlaps React Doctor. Treat remaining hits as suspects, not deletes. |
| `doctor` | Config / workspace readiness | `tools/testing` has no `package.json`; that warning is expected. Do not add a fake package. |

Machine output: add `--format json --quiet` and parse stdout. `--pretty` only
with `--format json`.

Scope a path after the subcommand if needed (`npx --yes fallow@3.27.0 dupes packages/server`).
The whole-project graph still builds; only reported findings narrow.

## Periodic scan

Default when the user says `/fallow` or “定期扫描” without a lens:

```bash
npx --yes fallow@3.27.0 audit
```

On a branch with a remote base, leave the default base-ref detection. Locally,
`--changed-since origin/main` (or `HEAD~15`) is fine. Report the score / clone
groups / new dead-code; **do not** start deleting or extracting clones unless
asked. A later cleanup is its own PR.

## False positives (do not “fix” these)

`.fallowrc.json` already seeds browser/e2e/tsdown/oxlint entries and ignores
the known non-import deps. Residual noise still includes:

- **`@ff-labs/pi-fff`** — copy island + `additionalExtensionPaths`, never a static import
- **Root toolchain** (`@getpie/oxlint`, `@getpie/verify`, `@shadcn/lint`, `unrun`, `agent-cli-detector`) — scripts / jsPlugins / Vite configs
- **Workspace placement** — `tw-animate-css` in app used by ui; `@effect/vitest` in contract used elsewhere; `use-stick-to-bottom` in ui used by app
- **`dist/server.mjs` / `pi-process.js`** — build artifacts, ignored as unresolved imports
- **`.test-d.ts`**, Effect error `.message` accessors
- **`recommend` `has_typescript: false`** — wrong; this repo is TypeScript
- **Unused public types** on server RPC barrels — often the exported contract surface

Zero-config (no `.fallowrc.json`) will also flag `http/main.ts`, oxlint
plugins, desktop pack scripts, and `*.test.tsx` / e2e as unused files. If you
see that list, you are not reading the repo config — rerun from the repo root.

## Real signals worth mentioning

Do not delete vendored `packages/ui/src/components/*` to please the scanner
(ADR 0001). Candidates to *report*, not auto-fix:

- `packages/server/src/harness/events/session.ts` — re-export barrel, no importers
- catalog `p-queue` — declared, never imported
- `packages/pi-loop/src/cron.ts` ↔ `packages/server/src/schedule/cron.ts`
- Files / Review / PR tree and diff adapters
- `rpc-mode.ts` `handleCommand`, `schedule/mutations`, `chat.ts` `#hydrateFromSnapshot`

## After the run

Summarize findings. Do not open a cleanup PR from an unsolicited scan. Do not
silence leftovers by growing `ignoreDependencies` unless a new class of
false positive is proven. Pair unused/circular hits with
`.agents/skills/react-doctor` if the user wants them fixed — Doctor is the gate.
