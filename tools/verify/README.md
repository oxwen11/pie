# @getpie/verify

Workspace toolchain for isolated Pie proofs. Installed at the repo root as a
`devDependency`. The command every verify skill calls is **`pie-verify`**.

This is **not** `@getpie/cli` (`packages/pie`, bin `pie`). That is the product
CLI.

| Surface   | Skill recipe                        | Isolation                                                              |
| --------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `web`     | `.agents/skills/verify-pie`         | Vite **4190** + foreground dev server **4180**, `/tmp/pie-verify-web/` |
| `cli`     | `.agents/skills/verify-pie-cli`     | `pie` / `pie daemon` on **4182**, `/tmp/pie-verify-cli/`               |
| `desktop` | `.agents/skills/verify-pie-desktop` | Electron + token daemon, CDP **9223**, `/tmp/pie-verify-desktop/`      |

```bash
pnpm exec pie-verify web launch
pnpm exec pie-verify web doctor
agent-browser open http://localhost:4190/
agent-browser find role button --name "Import project" click
pnpm exec pie-verify web cleanup

pnpm exec pie-verify cli launch
pnpm exec pie-verify cli doctor
pnpm exec pie-verify cli run daemon status
pnpm exec pie-verify cli cleanup

pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
agent-browser get title
pnpm exec pie-verify desktop cleanup
```

Fresh Web and Desktop runs register their isolated sample Project by default.
Use `launch --replace --empty-projects` only when proving the first-import flow.

After launch, **drive with `agent-browser`**. Launch writes a native env file
(`session`, `namespace`, sockets, screenshots/downloads, idle timeout off,
plus forced headless Chrome for web or CDP + `PIN_TAB` for desktop). Use
`PIE_VERIFY_BROWSER_HEADED=1` on Web `launch --replace` for an explicit visible
browser. Desktop Verify sets `PIE_DESKTOP_BACKGROUND=1`, keeping Electron hidden
and non-activating; set it to `0` with `launch --replace` for a visible run. The repo shim
(`tools/verify/bin/agent-browser`, also `pnpm exec agent-browser`) loads that
env, ensures one numbered run-local recording is active at 60 fps, then
forwards your command unchanged to the mise-managed agent-browser 0.38.1.
Each `evidence init` stops the current clip and selects the next number; cleanup
stops and flushes the current recording. Always pass an explicit `open` URL. `web env` / `desktop env` remain an
optional dump. `cli` has no page.

## Parallel verification

Use **one worktree and one isolation root per task**. Keep `HOME` and the operator's
Pi model/auth configuration unchanged. Launch refuses a rewritten `HOME` or an
empty `PI_CODING_AGENT_DIR` before it spawns anything. Roots use the existing
`runs/<id>/pie-home` layout; no global registry or new metadata format is needed.

In separate shells/worktrees (choose unused ports):

```bash
# Task A
export VERIFY_PIE_ROOT=/tmp/pie-verify-web-a PIE_PORT=4184 PIE_VITE_PORT=4194
pnpm exec pie-verify web launch
pnpm exec pie-verify web doctor
/tmp/pie-verify-web-a/bin/agent-browser open http://localhost:4194/

# Task B, in its own worktree
export VERIFY_PIE_ROOT=/tmp/pie-verify-web-b PIE_PORT=4186 PIE_VITE_PORT=4196
pnpm exec pie-verify web launch
pnpm exec pie-verify web doctor
/tmp/pie-verify-web-b/bin/agent-browser open http://localhost:4196/
```

`PIE_VITE_PORT` is a Verify override forwarded to Vite's native `--port`; the
default remains 4190 and strict binding stays enabled. API and Vite ports must
be different. Occupied ports fail rather than attaching to another run.

For Desktop, use distinct `VERIFY_PIE_DESKTOP_ROOT` and
`PIE_REMOTE_DEBUG_PORT` values. For CLI, use distinct `VERIFY_PIE_CLI_ROOT` and
`PIE_PORT` values. Desktop renderer/daemon ports are discovered and ownership
checked. Browser sockets/profiles and evidence are already run-scoped; do not
share a socket-directory override. Use each root's generated browser script:
it preserves its root, worktree, session and evidence destination even when
another surface is current or the calling shell has another task's environment.
Bare `agent-browser` remains ambiguous when multiple surfaces are current.

Keep the same root environment for `doctor`, `evidence` and `cleanup`. Cleanup
with an explicit run directory targets **that run**, never a different `current`.
Outside-root, wrong-worktree/surface and corrupt metadata are refused before
stopping processes. A missing explicit directory does not fall back to current.
Cleaning one task must leave the other healthy and its evidence intact.

Same-root lifecycle operations and same-worktree builds remain **serial**; there
is no shared-root launch lock or build scheduler. Never use `--replace` to take
another task's root. Shared Pi configuration changes (login, settings, plugin
installation) are not isolated by `PIE_HOME`; keep those operations serial and
separately authorized. In the current product, creating a Session with an explicit
model and changing a Session's model also persist Pi's **global default model**
(`persistDefaultPiModel`). Serialize those operations too; then drive existing
Sessions in parallel. `PIE_HOME` alone does not make all Pi settings run-local.
Parallel model calls still obey provider rate limits.

Cold-start recipes and feature maps stay in the skill trees
(`.cursor/skills/verify-pie*` are symlinks). Shared process/HTTP/JSON helpers
are `@getpie/verify/runtime`. Launch/doctor/cleanup/evidence orchestration is
one lifecycle; each surface only supplies spawn, probe, and stop.
Loopback health/ticket/warmup use `node:http` and try `[::1]` so Vite's
IPv6-only 4190 is reachable when global `fetch` is intercepted or `localhost`
is IPv4.

**Helper is Node 24.** `pie-verify`, the source pie CLI, and Electron's Node side stay on Node. Source pie is `node --experimental-transform-types --import tools/node/register-ts-hook.mjs`. pie-pi-process stays Bun.
