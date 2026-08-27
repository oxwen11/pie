# Toolchain constraints

- **Dependencies:** `pnpm-workspace.yaml` has six catalogs (`catalog:`,
  `catalog:effect`, `catalog:orpc`, `catalog:react`, `catalog:tailwind`,
  `catalog:tiptap`) plus `overrides` that pull _transitive_ deps onto catalog
  versions — bumping a package's own `package.json` for `vite`, `vitest`,
  `effect`, or `@effect/*` does nothing. Several pins are caret-free because a
  caret breaks the runtime. The reasons are commented inline; read them before
  changing versions. `packages/server` pins the Claude SDK as a literal while
  `packages/pie` uses `catalog:` — bump both together.
- **Lint:** `lint` / `lint:check` are turbo tasks (`dependsOn:
  ["@getpie/oxlint#build"]`, uncached) so the anti-slop plugins exist in
  `tools/oxlint/dist/` before oxlint loads them. `lint:check` still runs
  `--deny-warnings`, so the whole `suspicious` category fails CI while only
  warning locally. oxfmt reorders imports and stays a root-only script.
  Custom JS plugins live in `tools/oxlint/` (`pie`, `pie-boundaries`,
  `pie-query`, vendored `anti-slop` / `anti-slop-effect`). Effect service
  types keep the `Shape` suffix (`Context.Service<Self, Shape>`), so
  `anti-slop/no-shape-in-symbol-names` is off. Composition roots still call
  `make*` constructors, so `anti-slop-effect/no-service-constructor-imports`
  is off. Plugin RuleTester files are `@getpie/oxlint`'s `test`
  script, so they run with the rest of the repo under `pnpm test` — not
  via `lint:check`.
- **Commits rewrite files:** pre-commit runs `@getpie/oxlint#build` then
  lint-staged (`oxlint --fix` + `oxfmt`) over every staged file. No typecheck,
  no tests. `SKIP_SIMPLE_GIT_HOOKS=1` skips it. Hooks only exist after
  `pnpm install` — `prepare` sets `core.hooksPath`, which is also what makes
  them fire inside worktrees.
- **Tests:** no root vitest workspace; every package has its own config and goes
  through turbo. Layout is inconsistent — `server`/`contract`/`harness` use
  `test/`, everyone else colocates `src/**/*.test.ts` behind an explicit
  `include`, so a test file placed elsewhere is silently ignored. `server` and
  `harness` enable `test.typecheck`, so type errors fail the run.
  `apps/desktop/e2e/` is Playwright and not in CI. `tools/testing/fake-claude.mjs`
  is referenced by relative path from both server tests and desktop e2e.
- **Assertions:** the runner is always vitest; only the assertion library splits.
  Effect tests (`it.effect`, `layer`) use `node:assert/strict`, plain synchronous
  `it` uses vitest `expect` — currently no exceptions either way. The `/strict`
  suffix is load-bearing: bare `node:assert` is the legacy `==` mode, where
  `assert.equal(1, "1")` passes silently. Under `/strict`, `deepEqual` _is_
  `deepStrictEqual` and `equal` _is_ `strictEqual`, so always write the short
  name. `@effect/vitest` re-exports all of vitest, so a test that touches no
  Effect API can import `describe`/`expect`/`it` from it — import from `vitest`
  instead, and keep `@effect/vitest` meaning "this test runs an Effect".
