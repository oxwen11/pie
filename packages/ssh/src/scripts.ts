/** Remote shell payloads piped to `ssh … sh -l -s`. Keep them valid POSIX sh. */

export type RemotePieRunnerOptions = {
  readonly packageSpec?: string;
  readonly nodeScriptPath?: string | null;
  readonly nodeEngineRange?: string | null;
};

export const DEFAULT_REMOTE_PORT = 4000;
export const REMOTE_LAUNCH_TIMEOUT_MS = 90_000;
export const SSH_READY_TIMEOUT_MS = 20_000;
export const SSH_READY_PROBE_TIMEOUT_MS = 1_000;
export const TUNNEL_SHUTDOWN_TIMEOUT_MS = 2_000;
/** Pie's published engine: Node 24 only. */
export const DEFAULT_NODE_ENGINE_RANGE = ">=24.0.0 <25";
/** Default remote npx spec. Override with `PIE_SSH_CLI_PACKAGE` or `packageSpec`. */
export const DEFAULT_PIE_PACKAGE_SPEC = "@getpie/cli@latest";
export const PIE_SSH_CLI_PACKAGE_ENV = "PIE_SSH_CLI_PACKAGE";

export function resolveRemotePiePackageSpec(
  explicit?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = env[PIE_SSH_CLI_PACKAGE_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_PIE_PACKAGE_SPEC;
}

function stripTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function applyScriptPlaceholders(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let result = template;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.replaceAll(`@@${token}@@`, value);
  }
  return result;
}

export const REMOTE_NODE_ENV_SCRIPT = `PIE_NODE_ENGINE_RANGE=@@PIE_NODE_ENGINE_RANGE@@

prepend_path_if_dir() {
  if [ -d "$1" ]; then
    case ":$PATH:" in
      *":$1:"*) ;;
      *) PATH="$1:$PATH" ;;
    esac
  fi
}

remote_node_major_is_24() {
  command -v node >/dev/null 2>&1 || return 1
  PIE_NODE_RAW=$(node -v 2>/dev/null) || return 1
  case "$PIE_NODE_RAW" in
    v24.*|24.*) return 0 ;;
  esac
  return 1
}

prefer_node_from_dirs() {
  PIE_MATCH=
  for PIE_NODE_BIN in "$@"; do
    if [ -x "$PIE_NODE_BIN/node" ]; then
      PIE_SAVED=$PATH
      PATH="$PIE_NODE_BIN:$PATH"
      export PATH
      if remote_node_major_is_24; then
        PIE_MATCH=$PIE_NODE_BIN
      fi
      PATH=$PIE_SAVED
      export PATH
    fi
  done
  if [ -n "$PIE_MATCH" ]; then
    PATH="$PIE_MATCH:$PATH"
    export PATH
    return 0
  fi
  return 1
}

ensure_remote_node_path() {
  # Always put a user-local pie on PATH before returning. Finding Node 24 in
  # fnm must not skip ~/.local/bin, or the runner falls through to npx.
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"

  if remote_node_major_is_24; then
    return 0
  fi

  # Scan $HOME installs before PATH/nvm.sh. Login sh -l skips .zshrc, so
  # Homebrew Node 25 or nvm's default 20 must not shadow fnm/mise Node 24.
  if [ -z "\${FNM_DIR:-}" ]; then
    FNM_DIR="$HOME/.local/share/fnm"
  fi
  export FNM_DIR
  prefer_node_from_dirs "$FNM_DIR"/node-versions/*/installation/bin "$HOME/.fnm"/node-versions/*/installation/bin && return 0

  prefer_node_from_dirs "$HOME/.local/share/mise/installs/node"/*/bin "$HOME/.mise/installs/node"/*/bin && return 0

  if [ -z "\${NVM_DIR:-}" ]; then
    NVM_DIR="$HOME/.nvm"
  fi
  export NVM_DIR
  prefer_node_from_dirs "$NVM_DIR"/versions/node/*/bin && return 0

  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/usr/local/bin"
  if remote_node_major_is_24; then
    return 0
  fi

  prepend_path_if_dir "$FNM_DIR"
  prepend_path_if_dir "$HOME/.fnm"
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash 2>/dev/null)" || true
    fnm use 24 >/dev/null 2>&1 || fnm use default >/dev/null 2>&1 || fnm use --silent-if-unchanged >/dev/null 2>&1 || true
  fi
  if remote_node_major_is_24; then
    return 0
  fi

  prepend_path_if_dir "$HOME/.local/share/mise/shims"
  prepend_path_if_dir "$HOME/.mise/shims"
  if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate sh 2>/dev/null)" || true
  fi
  if remote_node_major_is_24; then
    return 0
  fi

  if [ -z "\${VOLTA_HOME:-}" ]; then
    VOLTA_HOME="$HOME/.volta"
  fi
  export VOLTA_HOME
  prepend_path_if_dir "$VOLTA_HOME/bin"
  if remote_node_major_is_24; then
    return 0
  fi

  prepend_path_if_dir "$HOME/.asdf/shims"
  prepend_path_if_dir "$HOME/.asdf/bin"
  if [ -s "$HOME/.asdf/asdf.sh" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.asdf/asdf.sh"
  fi
  if remote_node_major_is_24; then
    return 0
  fi

  prepend_path_if_dir "$HOME/.nodenv/bin"
  prepend_path_if_dir "$HOME/.nodenv/shims"
  if command -v nodenv >/dev/null 2>&1; then
    eval "$(nodenv init - 2>/dev/null)" || true
  fi
  if remote_node_major_is_24; then
    return 0
  fi

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    NVM_NO_USE=1
    export NVM_NO_USE
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      nvm use --silent 24 >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent --lts >/dev/null 2>&1 || true
    fi
  fi
  if remote_node_major_is_24; then
    return 0
  fi

  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"
  if remote_node_major_is_24; then
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    PIE_NODE_RAW=$(node -v 2>/dev/null) || PIE_NODE_RAW=unknown
    printf 'Remote Node %s does not satisfy required range %s. pie needs Node 24.\\n' "$PIE_NODE_RAW" "$PIE_NODE_ENGINE_RANGE" >&2
  else
    printf 'Remote host is missing node on PATH. Install Node 24 or configure a supported version manager for non-interactive shells.\\n' >&2
  fi
  return 1
}
`;

export const REMOTE_RUNNER_SCRIPT = `#!/bin/sh
set -eu
@@PIE_NODE_ENV_SCRIPT@@
if ! ensure_remote_node_path; then
  exit 1
fi
PIE_NODE_SCRIPT_PATH=@@PIE_NODE_SCRIPT_PATH@@
if [ -n "$PIE_NODE_SCRIPT_PATH" ]; then
  exec node "$PIE_NODE_SCRIPT_PATH" "$@"
fi
if command -v pie >/dev/null 2>&1; then
  exec pie "$@"
fi
require_installed_pie_cli() {
  PIE_CLI_PATH="$("$@" -- sh -c 'command -v pie' || true)"
  if [ -n "$PIE_CLI_PATH" ]; then
    return 0
  fi
  printf 'Remote host installed %s but npm produced no pie executable. Install Node 24 and the pie CLI on the remote host, then try again.\\n' @@PIE_PACKAGE_SPEC@@ >&2
  return 1
}
if command -v npx >/dev/null 2>&1; then
  require_installed_pie_cli npx --yes --package @@PIE_PACKAGE_SPEC@@ || exit 1
  exec npx --yes @@PIE_PACKAGE_SPEC@@ "$@"
fi
if command -v npm >/dev/null 2>&1; then
  require_installed_pie_cli npm exec --yes --package @@PIE_PACKAGE_SPEC@@ || exit 1
  exec npm exec --yes @@PIE_PACKAGE_SPEC@@ -- "$@"
fi
printf 'Remote host is missing the pie CLI and could not install @@PIE_PACKAGE_SPEC@@ because node/npm/npx are unavailable on PATH. Install Node 24 and pie, or configure a supported version manager for non-interactive shells.\\n' >&2
exit 1
`;

export const REMOTE_LAUNCH_SCRIPT = `set -eu
# Drop client-side SendEnv leaks so the remote daemon uses ~/.pie, not ~/.pie-dev.
unset NODE_ENV PIE_HOME PIE_DAEMON_DIR PIE_AUTH_TOKEN PIE_PORT PIE_CORS_ORIGINS || true
@@PIE_NODE_ENV_SCRIPT@@
STATE_KEY="$1"
STATE_DIR="$HOME/.pie/ssh-launch/$STATE_KEY"
DAEMON_RECORD="$HOME/.pie/daemon/daemon.pid"
LOG_FILE="$STATE_DIR/server.log"
RUNNER_FILE="$STATE_DIR/run-pie.sh"
mkdir -p "$STATE_DIR"
cat >"$RUNNER_FILE" <<'SH'
@@PIE_RUNNER_SCRIPT@@
SH
chmod 700 "$RUNNER_FILE"
if ! ensure_remote_node_path; then
  exit 1
fi
if ! "$RUNNER_FILE" daemon start >>"$LOG_FILE" 2>&1; then
  printf 'Remote pie daemon failed to start. Last log:\\n' >&2
  if [ -s "$LOG_FILE" ]; then
    tail -n 80 "$LOG_FILE" >&2 2>/dev/null || true
  else
    printf 'It wrote nothing to %s, so it exited before producing any output.\\n' "$LOG_FILE" >&2
  fi
  exit 1
fi
node - "$DAEMON_RECORD" <<'NODE'
const fs = require("node:fs");
const recordPath = process.argv[2] ?? "";
try {
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const address = String(record.address ?? "");
  const url = new URL(address);
  const port = Number(url.port);
  const token = String(record.token ?? "");
  if (!Number.isInteger(port) || port <= 0 || token.length === 0) {
    process.stderr.write("Remote pie daemon.pid is missing a loopback port or token.\\n");
    process.exit(1);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    process.stderr.write("Remote pie daemon is not bound to loopback.\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ remotePort: port, token: token, serverKind: "daemon" }) + "\\n");
} catch (cause) {
  process.stderr.write("Remote pie daemon did not write a valid discovery record at " + recordPath + ".\\n");
  process.exit(1);
}
NODE
`;

export function buildRemoteNodeEnvScript(input?: RemotePieRunnerOptions): string {
  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_NODE_ENV_SCRIPT, {
      PIE_NODE_ENGINE_RANGE: shellSingleQuote(
        input?.nodeEngineRange?.trim() || DEFAULT_NODE_ENGINE_RANGE,
      ),
    }),
  );
}

export function buildRemotePieRunnerScript(input?: RemotePieRunnerOptions): string {
  const packageSpec = shellSingleQuote(resolveRemotePiePackageSpec(input?.packageSpec));
  const nodeScriptPath = input?.nodeScriptPath?.trim() || "";
  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_RUNNER_SCRIPT, {
      PIE_PACKAGE_SPEC: packageSpec,
      PIE_NODE_SCRIPT_PATH: shellSingleQuote(nodeScriptPath),
      PIE_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    }),
  );
}

export function buildRemoteLaunchScript(input?: RemotePieRunnerOptions): string {
  return applyScriptPlaceholders(REMOTE_LAUNCH_SCRIPT, {
    PIE_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    PIE_RUNNER_SCRIPT: stripTrailingNewlines(buildRemotePieRunnerScript(input)),
  });
}
