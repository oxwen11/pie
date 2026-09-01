# verify-runtime

Shared TypeScript for the three Pie verification skills. Not a fourth
surface: no `/tmp` home, no ports, no launch.

Helpers used to be Bash that shelled out to `node -e` for JSON and URLs.
That was cargo-culted from a process-orchestration SOP. They are TypeScript
now so the next agent (and a human) can read them.

**Do not run these with Bun.** Pie, the daemon, `tsx`, `pnpm`, and Electron's
Node side are **Node >= 24**. Bun is a third runtime (different module
resolution, no tsdown `PIE_DAEMON_COMPATIBILITY_KEY`, PATH fights with the
cloud Node 22). Each skill `bin/*` finds Node 24 and runs that skill's
`src/cli.ts` via `node --experimental-strip-types`.
