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
  exits. It is not bound to one Session. Bash keeps stripping every `PIE_*`
  variable. `respond` is not an MCP tool. `pie session respond` stays human. Sessions cannot be
  deleted through CLI, oRPC, or MCP; archive is the only way to put one away.
- `pie mcp` prints a bearer derived from the daemon token. It is not the daemon
  credential, so it opens `/mcp` and nothing under `/api/`.
- `pr` is a Session's saved PR association (`link`, `ls`, `exclude`). `pullRequest` is the GitHub pull request. Do not use one name for both.
- Session is the default CLI object. Use `pie ls`, not `pie session ls`.
  `pie session queue` is a full replace of `session.queue` (`steering` and
  `followUp`; empty arrays clear it). Schedule verbs match `scheduleContract`:
  list, get, create, update, delete, runNow. There is no pause verb and no
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
