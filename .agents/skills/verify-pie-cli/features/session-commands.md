# Session commands

Session is the default object. Daily verbs are at the root. The rest are `pie session`.

Root: `run`, `send`, `ls`, `logs`, `wait`, `interrupt`.

`pie session`: `rename`, `model`, `queue`, `archive`, `respond`. Sessions are archived, never deleted.

`project`, `schedule`, `pr`, and `mcp` stay their own root nouns.

## How to get to it

Launch with a fake Pi so a turn does not need a provider. The daemon must inherit these:

```bash
export PIE_E2E=1
export PIE_E2E_PI_EXECUTABLE="$PWD/tools/test/fake-pi.js"
export PIE_E2E_PI_RESPONSE=VERIFY_FAKE_PI
pnpm exec pie-verify cli launch
pnpm exec pie-verify cli doctor
```

## Driving it

```bash
WS=$(mktemp -d /tmp/pie-verify-session-XXXX)
pnpm exec pie-verify cli run project create "$WS" --json
pnpm exec pie-verify cli run run --cwd "$WS" --no-wait -q "verify session"
pnpm exec pie-verify cli run ls --cwd "$WS" --json
pnpm exec pie-verify cli run logs <sessionId> --json
pnpm exec pie-verify cli run send <sessionId> --no-wait -q "verify send"
pnpm exec pie-verify cli run session rename <sessionId> "renamed"
pnpm exec pie-verify cli run session archive <sessionId>
pnpm exec pie-verify cli run ls --cwd "$WS" --json
pnpm exec pie-verify cli run session archive <sessionId> --undo
```

Proof:

- `run --no-wait` prints a session id. `ls --json` contains that id and the prompt title.
- `logs --json` returns messages for that id.
- `send --no-wait` exits 0.
- `session archive` removes it from `ls`; `ls --all` still shows it. `--undo` brings it back.
- There is no `session rm` command: `pie session rm` exits non-zero as an unknown command.
- fake-pi does not persist history. A session whose runtime was closed (for example by `archive`) cannot be resumed, so `run --from` and `session_handoff` against it fail and create nothing. Use a source that has not been archived.
- Do not assert transcript text from `pie logs` as the model reply. fake-pi does not persist history. Assert the id and the submitted prompt via the CLI exit and `ls`.
