#!/usr/bin/env bash
# Shared paths and checks for verify-pie helpers. Sourced, not executed.

set -euo pipefail

VERIFY_PIE_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_PIE_SKILL="$(cd "${VERIFY_PIE_BIN}/.." && pwd)"
VERIFY_ROOT="${VERIFY_PIE_ROOT:-/tmp/verify-pie}"
CURRENT_LINK="${VERIFY_ROOT}/current"
DEFAULT_PIE_PORT=4180
# Vite is hardcoded to 4190 with strictPort in apps/app/vite.config.ts.
VITE_PORT=4190
SAMPLE_PROJECT_NAME="verify-pie-sample"
SAMPLE_MARKER=".verify-pie-scaffold"

verify_pie_repo_root() {
  if [[ -n "${VERIFY_PIE_REPO:-}" && -f "${VERIFY_PIE_REPO}/pnpm-workspace.yaml" ]]; then
    printf '%s\n' "${VERIFY_PIE_REPO}"
    return 0
  fi
  local dir="${VERIFY_PIE_SKILL}"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/pnpm-workspace.yaml" ]]; then
      printf '%s\n' "${dir}"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  echo "verify-pie: could not find the pie repo root (pnpm-workspace.yaml)" >&2
  return 1
}

verify_pie_use_node24() {
  local nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  if [[ -s "${nvm_dir}/nvm.sh" ]]; then
    set +u
    # shellcheck disable=SC1091
    . "${nvm_dir}/nvm.sh"
    nvm use 24 >/dev/null
    set -u
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if ((major < 24)); then
    echo "verify-pie: pie serve requires Node >= 24 (found $(node -v)). Use nvm: nvm use 24" >&2
    return 1
  fi
}

verify_pie_listen_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
    return 0
  fi
  echo "verify-pie: lsof is required to check port ${port}" >&2
  return 1
}

verify_pie_http_ok() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 2 "${url}" 2>/dev/null || true)"
  [[ "${body}" == "ok" ]]
}

verify_pie_current_run() {
  if [[ -L "${CURRENT_LINK}" || -d "${CURRENT_LINK}" ]]; then
    readlink -f "${CURRENT_LINK}"
    return 0
  fi
  return 1
}

verify_pie_pid_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

verify_pie_read_pid() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    tr -d '[:space:]' <"${file}"
  fi
}

verify_pie_evidence_dir_for() {
  local run_id="$1"
  printf '%s\n' "${VERIFY_PIE_SKILL}/evidence/${run_id}"
}

verify_pie_json_get() {
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = data[key];
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$1" "$2"
}
