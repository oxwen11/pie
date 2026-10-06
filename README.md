<p align="center">
  <img src="apps/desktop/resources/pie.svg" width="96" alt="pie">
</p>

<h1 align="center">pie</h1>

<p align="center">
  <b>Run Pi in the background on machines you own. Review the PR.</b>
</p>

<p align="center">
  Built only for <a href="https://github.com/earendil-works/pi">Pi</a>. pie embeds the Pi coding agent, so your Pi
  provider logins, settings, skills and session history carry over.
</p>

<!-- Hero media: a real run (worktree Session → diff review → pull request → checks). Not recorded yet. -->

> [!NOTE]
> Early preview. There are no prebuilt releases or desktop installers yet, and the published
> `@getpie/cli` on npm lags behind `main`. Run pie from source.

pie runs a local daemon that owns every live Pi session. The web app, the desktop app and the
`pie` CLI connect to it, so closing a window never stops the work.

- **Keeps running.** One resident daemon per Pie home; Sessions outlive the tab that started them.
- **On your hardware.** Your laptop, a workstation, or a host you reach over SSH, Tailscale or
  pie's own relay. Browsers pair with a one-time code instead of a shared token.
- **Isolated work.** A Session can get its own git worktree, created by the daemon.
- **Ends in a pull request.** Review the diff, follow the PR and its checks, and merge through
  your own authenticated `gh`.
- **Starts on its own.** Schedules fire a Session on a cron, interval, one-off or manual cadence.

## How Pi is used

Every Session is a real Pi `AgentSession` from
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi), hosted in a pie-owned
child process (`pie-pi-process`, run with Bun). pie pins the Pi version it ships with; it does not
launch a separately installed `pi` binary.

- Pi reads its usual agent directory (`~/.pi/agent`, or `PI_CODING_AGENT_DIR`), so provider
  logins, models and settings you configured for Pi apply to pie.
- Conversation history stays in Pi's own session storage. pie keeps only its own Session metadata
  (Project, title, worktree, linked pull requests) under `$PIE_HOME`.
  See [ADR 0002](docs/adr/0002-session-info-storage-floor-harness-overlay.md).
- A registered Project is trusted for Pi prompts, skills, and context, and for executing that
  Project's extension code. Pie-owned children load Pi's built-in, global, and Project extensions.
  The daemon model list does not load extensions. See [CONTEXT.md](CONTEXT.md).

## Concepts

The terms below are defined in [CONTEXT.md](CONTEXT.md).

| Term              | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Project**       | A directory registered with the daemon. Sessions always resolve their directory through one. |
| **Session**       | One Pi agent session in a Project, optionally in its own git worktree.                       |
| **Schedule**      | A job that starts or reuses a Session on a cadence. Listed under **Scheduled** in the app.   |
| **Environment**   | A pie daemon the desktop app talks to: `local`, or a remote daemon reached over SSH.         |
| **Content Panel** | The column beside the chat that hosts the review, terminal, file and pull request panels.    |

## What you can do

### Keep Pi working after you close the window

`pie` (or `pie daemon start`) starts the daemon or attaches to the one already running for this
Pie home; `pie daemon status` and `pie daemon stop` manage it. A running daemon is reused only when
its build matches ([ADR 0004](docs/adr/0004-daemon-lifecycle-and-compatibility.md)).

### Work from the browser, the desktop app or the terminal

The daemon serves the web app at its own address. The Electron app in
[`apps/desktop`](apps/desktop/README.md) starts or attaches to the daemon for its Pie home, and
leaves it running when you quit. From a shell or
from another agent:

```sh
pie run "Fix the flaky date test" --worktree   # prints the session id and project id, waits for idle
pie logs <session-id>                          # print the session's messages
pie send <session-id> "Also update the changelog"
pie wait <session-id>
pie respond <session-id> --request <id> --allow  # answer a pending tool or plan request
pie interrupt <session-id>
```

`pie <command> --help` documents every flag. Output is plain text by default and contract-shaped
with `--json`.

### Reach a daemon on another machine

- **SSH** (desktop app): add an SSH host; the app starts or attaches to the remote daemon and
  talks to it through a loopback `ssh -L` tunnel. Disconnecting leaves the remote daemon running.
- **Tailscale** (desktop app): optionally share this computer's daemon at its MagicDNS HTTPS name
  with `tailscale serve`.
- **Relay**: for a host with no inbound port, `pie relay listen` runs a public hop and
  `pie relay attach` connects the daemon out to it.
- **Pairing**: `pie pairing` mints a one-time code; a browser enters it once and never stores the
  daemon token.

What each path has to prove is listed in [remote access verification](docs/remote-access-verification.md).

### Isolate a task in a worktree

A Session created with a worktree gets its own checkout under `$PIE_HOME/worktrees/`. If the
checkout is removed, the Session offers an explicit restore of the stored branch.

### Review what Pi changed

The Content Panel opens beside the chat with a review panel for the diff, a terminal, a file
viewer and a pull request panel.

### Follow the pull request

When Pi opens a pull request, it links it to the Session. pie shows its diff, review state and
checks, understands stacked PRs, and can merge, enable or disable auto-merge, or merge and rebase
a stack. All GitHub access goes through your authenticated `gh`; merges pin the expected head
commit so GitHub rejects a stale merge
([ADR 0010](docs/adr/0010-github-pull-request-actions.md)).

### Let work start on a Schedule

A Schedule fires on a 5-field `cron` (optional IANA timezone), a fixed `every` interval, a single
`once` time, or `manual` only. Each run starts a fresh Session or reuses one, and the last 20 runs
are kept. After three consecutive failed runs a Schedule stops firing.

### Manage Pi packages and skills

The **Plugins** page browses and installs Pi packages and shows the skills available to a Project.

## Quickstart (from source)

Requirements: git, Node 24, pnpm 12.4.1, Bun 1.4.2 and a Rust toolchain (for a native helper).
[`mise.toml`](mise.toml) pins all of them. `gh` is needed only for pull request features.

```sh
git clone https://github.com/oxwen11/pie
cd pie
mise install          # or install the versions in mise.toml yourself
pnpm install
pnpm build

node packages/pie/dist/cli.js daemon start
# pie daemon started at http://127.0.0.1:4000 (pid …)

node packages/pie/dist/cli.js pairing
# a one-time code and its expiry
```

Open the printed address, enter the pairing code, then import a Project or start a new chat.
The daemon prefers port 4000 and picks a free port when 4000 is taken, so use the address it
prints. From a git checkout the Pie home defaults to `~/.pie_<branch>`; set `PIE_HOME` to choose
another. Other variables are listed in [configuration](docs/configuration.md).

**Model provider.** pie has no provider setup of its own. Configure a provider the way Pi
documents it (for example a provider API key, or logging in with the `pi` CLI); pie reads the same
`~/.pi/agent` directory.

**Desktop app.** `pnpm dev --filter=@getpie/desktop` from the repository root. See
[`apps/desktop/README.md`](apps/desktop/README.md).

## Roadmap

Planned, not on `main`:

- Panel plugins loaded from `$PIE_HOME` (in progress, [#302](https://github.com/oxwen11/pie/pull/302)).
- GitHub and Hub triggers for Schedules ([Hub RFC](docs/rfc/pie-hub.md), proposed).
- A persistent goal loop. Today `@getpie/pi-loop` is a session-scoped, in-memory `/loop`.
- Feeding CI failures back into the Session.
- Notifications.
- Context and cost statistics.
- A mobile client.

## When to use something else

- Several agents side by side, or a phone app today: [Paseo](https://github.com/getpaseo/paseo) or
  [T3 Code](https://github.com/pingdotgg/t3code).
- Event-triggered runs today: [Paseo Hub](https://github.com/getpaseo/hub).
- OpenCode with persistent goals and CI feedback: [OpenChamber](https://github.com/openchamber/openchamber).
- A one-command local Pi chat UI: [agegr/pi-web](https://github.com/agegr/pi-web).
- A polished Pi desktop app: [pi-gui](https://github.com/minghinmatthewlam/pi-gui).

## Contributing

- [AGENTS.md](AGENTS.md): contributor commands and repository rules.
- [CONTEXT.md](CONTEXT.md): domain vocabulary.
- [docs/](docs/README.md): architecture decisions, open proposals and operational references.

## Acknowledgements

- [Pi](https://github.com/earendil-works/pi), the agent pie is built around.
- [T3 Code](https://github.com/pingdotgg/t3code), whose pull request stack work informed
  [ours](docs/research/t3code-multiple-pull-requests-and-stacks.md).
- [Paseo](https://github.com/getpaseo/paseo), for the Hub idea.
- [OpenChamber](https://github.com/openchamber/openchamber).

## License

TODO: license not chosen yet. There is no LICENSE file in this repository.
