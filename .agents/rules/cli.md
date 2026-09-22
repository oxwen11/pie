# Pie CLI

`pie` is an agent-facing daemon client, not a second runtime or domain store.
Read the [command design](../../docs/design/pie-cli.md) for the surface and
[CONTEXT.md](../../CONTEXT.md) for vocabulary. Update that design when commands change.

## Compatibility contracts

- Product commands project `@getpie/contract` or daemon lifecycle. A new capability
  needs a corresponding contract change. Pi is the only agent; provider/model
  flags select a model, not a harness. `pie-verify` remains separate proof tooling;
  Hub commands enroll the daemon, not start a second Hub implementation.
- Defaults must be scriptable: no interactive prompts, pagers, ANSI/color,
  presentation tables, spinners, or token playback. Prefer short stable text;
  `-q` emits primary ids and `--json` emits contract-shaped data without an envelope.
- Exit codes: `0` success, `1` business/usage, `2` unreachable/unauthenticated.
  Failures use non-zero exits and stable stderr, not success-shaped stdout.
  Structured errors are available with `--json`. Additional codes need a real
  caller benefit over structured output.
- Default stdout changes are breaking changes. Introduce an explicit option or
  agree a compatibility plan instead of silently changing output.
- IDs are explicit; do not infer an active/focused session. Flags override env
  defaults (`PIE_URL`, `PIE_AUTH_TOKEN`, `PIE_PROJECT_ID`, `PIE_SESSION_ID`, `PIE_HOME`).
  Missing required ids fail clearly.
- Without a URL, attach/spawn locally under `$PIE_HOME`. `--url` / `PIE_URL` is
  connect-only: never spawn a daemon on that URL.
- New work creates a Session unless a session id is supplied. Without a Project
  id, resolve cwd through path-idempotent `project.create`; there is no subagent tree.
- Destructive commands remain non-interactive and require `--yes` where guarded.

Internal organization and additional output modes are design choices, provided
these contracts and the agreed command requirements are preserved.
