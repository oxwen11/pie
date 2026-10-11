# Configuration

Process environment read by the pie daemon and the foreground dev server. Names and defaults come from
[`packages/server/src/config/env.ts`](../packages/server/src/config/env.ts) and
[`packages/server/src/config/paths.ts`](../packages/server/src/config/paths.ts). Command-line
flags such as `--port` and `--host` take precedence over the matching variable.

| Variable            | Default                                         | Purpose                                                                                                                     |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PIE_HOME`          | `~/.pie`; `~/.pie_<branch>` from a git checkout | Pie home: daemon record, storage, logs and worktrees. One daemon runs per Pie home.                                         |
| `PIE_PORT`          | `4000`                                          | Port to listen on. The daemon falls back to a free port when the preferred one is taken.                                    |
| `PIE_AUTH_TOKEN`    | unset                                           | Bearer token for the HTTP/RPC surface. The daemon launcher generates one; set it yourself only for a foreground dev server. |
| `PIE_CORS_ORIGINS`  | empty                                           | Comma-separated extra origins allowed to make cross-origin requests.                                                        |
| `PIE_ALLOWED_HOSTS` | empty                                           | Comma-separated extra `Host` values, for a reverse proxy. Prefer `--host`, Tailscale Serve or `pie relay attach`.           |
| `PIE_LOG_LEVEL`     | `INFO`                                          | One of `DEBUG`, `INFO`, `WARN`, `ERROR`. Logs are written under `$PIE_HOME/logs`.                                           |
| `PIE_PRINT_LOGS`    | `false`                                         | Also print logs to the process output.                                                                                      |

`PIE_DAEMON_COMPATIBILITY_KEY` is set by the launcher to identify the build; you should not need
to set it. Pi's own configuration (providers, models, settings) lives in Pi's agent directory,
not here.
