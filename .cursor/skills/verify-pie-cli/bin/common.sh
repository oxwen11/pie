#!/usr/bin/env bash
# Shared paths and checks for verify-pie-cli helpers. Sourced, not executed.

set -euo pipefail

VERIFY_PIE_CLI_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_PIE_CLI_SKILL="$(cd "${VERIFY_PIE_CLI_BIN}/.." && pwd)"
VERIFY_ROOT="${VERIFY_PIE_CLI_ROOT:-/tmp/verify-pie-cli}"
CURRENT_LINK="${VERIFY_ROOT}/current"
DEFAULT_PIE_PORT=4182

verify_pie_cli_repo_root() {
  if [[ -n "${VERIFY_PIE_CLI_REPO:-}" && -f "${VERIFY_PIE_CLI_REPO}/pnpm-workspace.yaml" ]]; then
    printf '%s\n' "${VERIFY_PIE_CLI_REPO}"
    return 0
  fi
  local dir="${VERIFY_PIE_CLI_SKILL}"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/pnpm-workspace.yaml" ]]; then
      printf '%s\n' "${dir}"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  echo "verify-pie-cli: could not find the pie repo root (pnpm-workspace.yaml)" >&2
  return 1
}

verify_pie_cli_use_node24() {
  local nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  if [[ -s "${nvm_dir}/nvm.sh" ]]; then
    set +u
    # shellcheck disable=SC1091
    . "${nvm_dir}/nvm.sh"
    nvm use 24 >/dev/null
    set -u
    if [[ -n "${NVM_BIN:-}" ]]; then
      export PATH="${NVM_BIN}:${PATH}"
    fi
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if ((major < 24)); then
    echo "verify-pie-cli: pie requires Node >= 24 (found $(node -v)). Use nvm: nvm use 24" >&2
    return 1
  fi
}

verify_pie_cli_listen_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
    return 0
  fi
  echo "verify-pie-cli: lsof is required to check port ${port}" >&2
  return 1
}

verify_pie_cli_http_ok() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 2 "${url}" 2>/dev/null || true)"
  [[ "${body}" == "ok" ]]
}

verify_pie_cli_health_ok() {
  local address="$1"
  verify_pie_cli_http_ok "${address%/}/api/health"
}

verify_pie_cli_pid_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

verify_pie_cli_read_pid() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    tr -d '[:space:]' <"${file}"
  fi
}

verify_pie_cli_current_run() {
  if [[ -L "${CURRENT_LINK}" || -d "${CURRENT_LINK}" ]]; then
    readlink -f "${CURRENT_LINK}"
    return 0
  fi
  return 1
}

verify_pie_cli_json_get() {
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = data[key];
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$1" "$2"
}

verify_pie_cli_daemon_field() {
  local file="$1"
  local key="$2"
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = data[key];
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(typeof value === "string" ? value : String(value));
  ' "${file}" "${key}"
}

verify_pie_cli_redact_record() {
  local src="$1"
  local dest="$2"
  node -e '
    const fs = require("node:fs");
    const [src, dest] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(src, "utf8"));
    if (Object.prototype.hasOwnProperty.call(data, "token")) data.token = "[redacted]";
    fs.writeFileSync(dest, JSON.stringify(data, null, 2) + "\n");
  ' "${src}" "${dest}"
}

# tsx source does not get the tsdown define. Built `dist/cli.mjs` already has it.
verify_pie_cli_compat_key() {
  local repo="$1"
  (
    cd "${repo}"
    node --input-type=module -e 'import { resolveDaemonCompatibilityKey } from "./packages/core/dist/compatibility.mjs"; process.stdout.write(resolveDaemonCompatibilityKey({ cwd: process.cwd() }));'
  )
}

verify_pie_cli_tsx() {
  local repo="$1"
  shift
  export PIE_DAEMON_COMPATIBILITY_KEY="${PIE_DAEMON_COMPATIBILITY_KEY:-$(verify_pie_cli_compat_key "${repo}")}"
  (
    cd "${repo}/packages/pie"
    exec pnpm exec tsx src/node/cli.ts "$@"
  )
}

verify_pie_cli_apply_run_env() {
  local run_dir="$1"
  local meta="${run_dir}/meta.json"
  local repo
  export PIE_HOME
  export PIE_DAEMON_DIR
  export PIE_PORT
  PIE_HOME="$(verify_pie_cli_json_get "${meta}" pieHome)"
  PIE_DAEMON_DIR="$(verify_pie_cli_json_get "${meta}" daemonDir)"
  PIE_PORT="$(verify_pie_cli_json_get "${meta}" piePort)"
  export NODE_ENV=development
  repo="$(verify_pie_cli_json_get "${meta}" repo)"
  export PIE_DAEMON_COMPATIBILITY_KEY="${PIE_DAEMON_COMPATIBILITY_KEY:-$(verify_pie_cli_compat_key "${repo}")}"
}

verify_pie_cli_evidence_dir_for() {
  local run_id="$1"
  printf '%s\n' "${VERIFY_PIE_CLI_SKILL}/evidence/${run_id}"
}

verify_pie_cli_copy_failure_logs() {
  local run_dir="$1"
  local dest="${VERIFY_ROOT}/last-failure"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  if [[ -d "${run_dir}/logs" ]]; then
    cp -a "${run_dir}/logs/." "${dest}/"
  fi
  if [[ -f "${run_dir}/meta.json" ]]; then
    cp "${run_dir}/meta.json" "${dest}/meta.json"
  fi
  echo "verify-pie-cli: copied logs to ${dest}" >&2
}

verify_pie_cli_reserved_port() {
  local port="$1"
  case "${port}" in
    4000)
      echo "verify-pie-cli: refuse PIE_PORT=4000 — that is the user/desktop daemon port." >&2
      return 1
      ;;
    4180 | 4190)
      echo "verify-pie-cli: refuse PIE_PORT=${port} — reserved for web verify-pie (serve 4180 / Vite 4190)." >&2
      return 1
      ;;
    4183)
      echo "verify-pie-cli: refuse PIE_PORT=4183 — reserved for verify-pie-desktop." >&2
      return 1
      ;;
  esac
  return 0
}
