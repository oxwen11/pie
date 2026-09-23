# Toolchain

## Commands and setup

| Task | Command |
| --- | --- |
| Build / typecheck | `pnpm build` / `pnpm typecheck` |
| Lint + format + typecheck (no tests) | `pnpm check` |
| Node + browser tests | `pnpm test` |
| One package's tests | `pnpm --filter @getpie/server test` |
| Electron tests | `pnpm e2e` |
| Runtime verification | `pnpm exec pie-verify web\|cli\|desktop` |

- Build, typecheck, and lint run through Turbo for upstream builds, including
  oxlint plugins. Scope with `pnpm exec turbo run typecheck --filter=@getpie/server`,
  not package scripts. Use `--force` when changed inputs are outside the cache hash.
- Formatting is root-only oxfmt. `pnpm lint` / `pnpm format` rewrite files;
  `:check` variants report. Pre-commit builds oxlint plugins, then runs fixers on
  staged files — it does not run typecheck or tests. Inspect changes after commit.
- `pnpm clean` includes `git clean -xdf node_modules dist .turbo`, not a repo-wide
  clean. Review the target before using destructive cleanup.
- Cloud setup comes from `.cursor/environment.json` (mise + locked pnpm install).
  Follow [the web dev recipe](../skills/verify/SKILL.md): Vite is 4190, API 4180,
  daemon 4000. For isolated verification, use [verify-evidence.md](verify-evidence.md).

## Dependencies and checks

- `pnpm-workspace.yaml` owns catalogs, overrides, and pin rationale. Upgrade
  coupled families together; duplicate Effect/React/Vitest runtimes cause failures.
  Check package manifests for direct pins too, including the server and CLI.
- Lint rules and exceptions live in `oxlint.config.mts`, `oxlint-deferred.mts`,
  `tools/oxlint/`, and `doctor.config.json`; consult those instead of maintaining
  a prose copy of every diagnostic. CI treats warnings as failures. Fix or discuss
  a bad rule; do not silently suppress required checks to make a change pass.
- Do not run `ultracite init` over this repo: it overwrites project instructions
  and configuration. Existing scripts already configure the toolchain.

## Test harness constraints

- Root `pnpm test` runs separate node and Chromium Vitest processes. Keep them
  separate and keep the Vitest peer graph singular; duplicate runners break
  `@effect/vitest` suite registration. Do not run workspace tests through Turbo.
- UI component/product tests use Vitest browser mode; Electron uses Playwright.
  Use the relevant existing harness rather than treating one as proof of the other.
- Conversation/sync E2E runs real `pie-pi-process` with a seeded provider under
  isolated `$PIE_HOME/agent` (`PI_CODING_AGENT_DIR`); see
  `tools/testing/fake-e2e-provider.ts`. Connection/daemon/MessagePort cases do not
  use that provider. `fake-pi.mjs` remains for unit/RPC executable-replacement tests.
- Read the package's Vitest config before adding tests: include patterns and
  environment/typecheck settings differ, and an unmatched test can be silently skipped.
  Artifact tests require a build first. Server tests disable file parallelism because
  Git fixtures contend; do not enable it without isolating those fixtures.
- Use strict assertions. If using Node assertions, import `node:assert/strict`,
  not the coercive `node:assert`. Follow nearby tests for assertion style;
  see [stack.md](stack.md) for Effect resource lifetime and clock behavior.
- Verify owns isolated runs through `tools/verify`, not the product CLI. Use the
  mise-provided `agent-browser` through the repo shim after launch; it binds the
  correct run and recording. Do not replace it with a global npm installation.
