---
name: prune-tests
description: Recurring playbook for deleting meaningless UI unit tests. User-invoked only; never auto-invoke.
disable-model-invocation: true
---

# Prune meaningless tests

User-invoked only — run when the user asks (e.g. `/prune-tests`), never on
your own initiative. Recurring playbook for deleting unit tests that don't
earn their keep. Worked example: PR #249 (UI prune, +4/−621).

## Scope

Default surface: UI unit tests — `apps/app`, `packages/ui`, desktop renderer
(`apps/desktop/src/renderer`, plus `renderer-theme-bootstrap`-style bridges).
The process generalizes to other suites, but don't mix surfaces in one PR.
Test deletion never ships with behavior changes.

## The bar

A test earns its keep only if it can catch a plausible regression that is
neither instantly visible in dev nor compiler-enforced. When in doubt, read
the implementation under test — never judge from assertions alone.

Three questions for every test:

1. Plausible accidental breakage? Could a well-meaning refactor break this
   without touching the test's intent? If breakage requires deliberately
   rewriting the logic, the test guards nothing.
2. Instantly visible? Wrong theme, missing dots, a frozen loader — if dev or
   manual use catches it immediately, the unit test adds ~zero.
3. Compiler-enforced? A null-guard the type-checker already requires needs
   no test.

Delete when there is no plausible accidental breakage, when failure is
instantly visible, or when the compiler already enforces it. Trivial
implementation plus non-trivial requirement (e.g. "programmatic resizes must
not persist" behind a one-line `if`) still keeps its test.

## Delete patterns

1. Language-primitive echo — re-asserts `===`, `??`, ternaries,
   `JSON.stringify`, `Array.find`. (`platform-host`, `session-ref`,
   `draft-worktree-base`)
2. Constant echo — pixel values, style objects, magic numbers asserted back
   to themselves. Design tweaks break the test with zero bug signal.
   (`shell-chrome`)
3. Copy / className / icon echo — asserts literal strings, Tailwind classes,
   lucide icon imports. Copy changes and i18n become friction, not
   protection. (`session-status-indicator`, label maps)
4. Implementation-detail locks — element counts, absence-of-feature
   assertions (`querySelector("a") === null`), "no SVG" pins. Redesigns
   break them without bugs. (`pie-loader` 16-dot count)
5. Vacuous assertions — `toBeDefined` chains; timing tests that await but
   never assert timing (deleting the branch under test still passes).
   (`orpc` client smoke, `startup-animation`)
6. Partial literal echoes — a switch/map test covering a few branches with
   no behavioral assertion. Keep only full-coverage mappings of real
   conditionals.

## Keep patterns

1. State machines and subtle conditionals — anything a "simplification"
   could plausibly get wrong (`collapsed === open` sync, queue bounds with
   reference-identity returns, dotfolder visibility with exact-path escape).
2. Races, timing, dispose safety — especially with a regression history in
   comments (seq gating, truncated-buffer recovery, disposed-controller
   reads).
3. Policy tripwires with documented rationale — cache invalidation sets,
   inline-error key lists. They fail loudly on policy change; that's the
   point.
4. Parsing / merging / formatting with edge cases — path unions, cron
   round-trips, pluralization, duration math.
5. Security invariants — CSP hash vs bootstrap script, auth-gated behavior.
6. Wiring tests — listener subscribe/unsubscribe, storage persistence keys,
   DOM sync. Cheap and catch real leaks.

## Procedure

1. Inventory, scoped to the surface:
   `find . -name "*.test.*" -not -path "*/node_modules/*" -not -path "*/dist/*" | sort`
2. Read each test file AND its implementation. Measure logic complexity
   before judging.
3. Decide per file: wholly meaningless → delete the file; mixed → prune
   meaningless cases only and fix imports.
4. Migrate knowledge: if a deleted test's name documented a non-obvious
   rationale (why `copied → modified`), move it into a source comment.
   Delete the test, keep the knowledge.
5. Don't rewrite weak tests into strong ones — delete, don't polish. A
   timing test that needs a rewrite to be meaningful is deleted, not
   rewritten.
6. Verify: `vitest run --project <affected>` all green; `tsc --noEmit` per
   affected package; `format:check` clean.
7. Land as deletion-only PR(s), squash-merged. Note deliberately-kept
   high-value suites in the PR body so the next prune doesn't re-litigate
   them.

## Non-goals

- No behavior changes in a prune PR.
- No new tests in a prune PR (a missing guard discovered mid-prune is a
  separate PR).
- No scope expansion to non-UI suites without being asked.
