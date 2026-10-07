# One Session service behind the CLI and MCP

Pie runs only Pi. Session operations are not an orchestrator and do not switch
providers. The CLI and MCP are doors onto the existing Session, Schedule, and
pull-request services. Neither door owns a store.

## Decision

- Humans and scripts use the CLI. The in-process Pi and external clients use
  MCP. Both doors call the same service methods. MCP must not shell out to the CLI.
- Handoff creates a new Session. `--from` copies a budgeted selection of the
  source Session's messages into the new prompt: recent user and assistant text,
  the original request, and command results. It does not copy reasoning, tool
  state, or attachments. The new prompt is a separate part and is never shortened
  to make history fit. If the selection cannot fit, the command fails and creates
  nothing. Omitting `--from` starts a clean Session with only the new prompt.
- Do not store lineage or `createdBy`. The copied text lives in the new Session's
  first user message, which `session.create` and `session.send` already persist.
- The client protocol is `2025-11-25`, negotiated by `initialize`. Do not
  require `2026-07-28`. Pi's client does not speak that revision.
- The human CLI uses the daemon credential. An in-process Pi gets a bearer
  minted for that process. It opens `/mcp` only, and it is gone when the process
  exits. The server binds it to the one Session that process was spawned for,
  from its own record of who the bearer was issued to; the model never supplies
  that identity. A runtime acquired without a known Session gets no bearer. Bash
  keeps stripping every `PIE_*` variable. `respond` is not an MCP tool. `pie session respond` stays human. Sessions cannot be
  deleted through CLI, oRPC, or MCP; archive is the only way to put one away.
- `pie mcp` prints a bearer derived from the daemon token. It is not the daemon
  credential, so it opens `/mcp` and nothing under `/api/`.
  Under `pie serve` there is no daemon token: `/mcp` is still mounted but accepts only the
  per-process tokens issued to in-process Pi, and `pie mcp` has nothing to derive.
- `tools/list` publishes each tool's input schema (Effect Schema through
  `EffectSchemaToJsonSchemaConverter`). A model has no other way to learn the arguments.
- `pr` is a Session's saved PR association (`link`, `ls`, `exclude`). `pullRequest` is the GitHub pull request. Do not use one name for both.
- `pr_link`, `pr_ls` and `pr_exclude` act on the calling Session. With a bound bearer,
  `ref` / `refs` may be omitted and mean that Session; naming any other Session is
  `FORBIDDEN` and writes nothing. Every other caller (CLI, app, the `pie mcp` bearer) must
  pass `ref` / `refs`, else `INVALID_ARGUMENT`. The extension adds a short prompt guidance:
  link a PR right after creating it or starting work on it, each stack member separately,
  list before finishing, never `restore` unasked.
- This follows [session-pull-request-sync](../rfc/session-pull-request-sync.md) §3.2 for
  PR association: the server determines the full `SessionRef`, and the registration grant
  covers only the current Session. That RFC is unchanged. The orchestration tools
  (`session_*`, `schedule_*`, `project_*`) are a separate grant to the in-process Pi decided
  here; they are not PR-registration authority, and they still exclude the daemon token,
  `/api/`, delete and respond.
- Session is the default CLI object. Use `pie ls`, not `pie session ls`.
  `pie session queue` is a full replace of `session.queue` (`steering` and
  `followUp`; empty arrays clear it). Schedule verbs match `scheduleContract`:
  list, get, create, update, rm, run. There is no pause verb and no
  heartbeat. A recurring prompt into an existing Session is a Schedule with
  `session.policy: "existing"`.
- Project list and create call `project.ls` and `project.create`. They do not
  allocate a chat-project directory.
- A missing contract procedure lands in the same change as its command. No new
  session metadata field and no new host path.

| Capability                                   | CLI                                                   | MCP / extension tool                                  |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Start, optional handoff and worktree         | `pie run [--from] [--worktree]`                       | `session_run`                                         |
| Append, steer or follow-up, optional handoff | `pie send [--delivery] [--from]`                      | `session_send`                                        |
| Wait, read, interrupt                        | `pie wait` / `logs` / `interrupt`                     | `session_wait` / `session_logs` / `session_interrupt` |
| List, rename, set model                      | `pie ls` / `pie session rename` / `pie session model` | `session_ls` / `session_rename` / `session_model`     |
| Replace the queue                            | `pie session queue`                                   | `session_queue`                                       |
| Archive                                      | `pie session archive`                                 | `session_archive`                                     |
| Session PR association                       | `pie pr link` / `ls` / `exclude`                      | `pr_link` / `pr_ls` / `pr_exclude`                    |
| Schedule                                     | `pie schedule list\|get\|create\|update\|rm\|run`     | same names                                            |
| Project                                      | `pie project ls` / `create`                           | `project_ls` / `project_create`                       |

## Compatibility

The oRPC renames are a deliberate break with no aliases. A client and a daemon must run
the same side of it: `agent.session.*` → `session.*`, `project.list` → `project.ls`,
`schedule.delete` → `schedule.rm`, `schedule.runNow` → `schedule.run`, and
`pullRequest.{link,ls,exclude}` → `pr.*`. A new Desktop against an older remote daemon
(and an old Desktop against a new daemon) fails every renamed call. SSH environments run
whatever `pie` is on the remote PATH, with no version gate. The Developer accepted this;
see also [ADR 0005](0005-environment-rpc-routing.md).

## Rejected

Provider switch, agent profiles, capability flags, native subagents, fork and
merge-back as separate operations, pull-request watch and wake, agent permission
approval, terminals, plugins, and an agent-selected remote host. Pi
`session_before_switch` and `session_before_fork` stay cancelled. Hub and
terminal commands remain in [the CLI RFC](../rfc/pie-cli.md).

## Verification boundary

Automated tests are required and are not acceptance. Acceptance is a live daemon,
the real CLI, and a real MCP client. Use `fake-pi`. It does not persist history,
so assert the submitted prompt on `session.prompt.submitted`, not on `pie logs`
transcript text.

- MCP tests cover the bearer boundary: a missing token, the daemon token, and
  a browser Origin are refused. `respond` is not a tool, and there is no delete.
  They also cover the binding: a bearer issued to a spawned Pi child links PRs to
  that Session without a `ref`, and cannot link, exclude or list for another.
- Extend `packages/pie/src/node/session-cli.test.ts`, which already starts
  isolated `pie serve` with `PIE_E2E_PI_EXECUTABLE` pointing at
  `tools/test/fake-pi.js`. Cover `--from`, delivery, queue replace, `pie ls`,
  archive and unarchive, PR link, schedule run, and project
  create. Run `pnpm --filter @getpie/cli test` for that file.
- Runtime proof follows
  [verify-pie-cli](../../.agents/skills/verify-pie-cli/SKILL.md): launch, doctor,
  drive, evidence, cleanup. Do not use the web or desktop verify homes, and do
  not touch port 4000, 4180, or 4190. Set `PIE_E2E=1` and
  `PIE_E2E_PI_EXECUTABLE` when that daemon would otherwise launch a real Pi.
  Strip the daemon token from any copied `daemon.pid`. A skipped launch, a
  foreign daemon, or a socket failure is a gap, not a pass.
- Connect Pi's MCP client to the same isolated daemon at protocol `2025-11-25`.
  `session_run` must return an id that `pie ls` shows. An unfit `from` creates
  nothing. Do not mock the client or the service in this proof.

No browser screenshot or video. No test that a model reads the handoff and
continues the task.
