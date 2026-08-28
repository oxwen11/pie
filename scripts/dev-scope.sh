#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: bash scripts/dev-scope.sh --print|--shell" >&2
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -d ' ' -f 1
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d ' ' -f 1
  else
    printf '%s' "$1" | openssl dgst -sha256 | awk '{print $NF}'
  fi
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

resolve_worktree_root() {
  local cwd root
  cwd="$(pwd -P)"
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")"
  (cd "$root" && pwd -P)
}

sanitize_scope_basename() {
  local sanitized
  sanitized="$(printf '%s' "$1" | LC_ALL=C sed \
    -e 's/[^A-Za-z0-9._-]/-/g' \
    -e 's/--*/-/g' \
    -e 's/^[-.]*//' \
    -e 's/[-.]*$//')"
  printf '%s' "${sanitized:-worktree}"
}

set_dev_values() {
  local basename root_hash port_hash port_number base_port
  worktree_root="$(resolve_worktree_root)"
  basename="$(sanitize_scope_basename "$(basename "$worktree_root")")"
  root_hash="$(sha256 "$worktree_root")"
  derived_scope="$basename-${root_hash:0:8}"
  scope="${PIE_DEV_SCOPE_OVERRIDE:-$derived_scope}"
  home="${PIE_DEV_HOME:-$HOME/.pie-dev/worktrees/$scope}"
  daemon_dir="$home/daemon"

  port_hash="$(sha256 "$scope")"
  printf -v port_number '%u' "0x${port_hash:0:8}"
  base_port=$((20000 + port_number % 20000))
  server_port="${PIE_DEV_SERVER_PORT:-$base_port}"
  app_port="${PIE_DEV_APP_PORT:-$((base_port + 1))}"
  desktop_port="${PIE_DEV_DESKTOP_PORT:-$((base_port + 2))}"
  cors_origins="${PIE_DEV_CORS_ORIGINS:-}"
  allowed_hosts="${PIE_DEV_ALLOWED_HOSTS:-}"
}

print_export() {
  printf 'export %s=%s\n' "$1" "$(shell_quote "$2")"
}

print_shell() {
  print_export NODE_ENV development
  print_export PIE_DEV_SCOPE "$scope"
  print_export PIE_HOME "$home"
  print_export PIE_DAEMON_DIR "$daemon_dir"
  print_export PIE_PORT "$server_port"
  print_export PIE_APP_PORT "$app_port"
  print_export PIE_DESKTOP_PORT "$desktop_port"
  print_export PIE_CORS_ORIGINS "$cors_origins"
  print_export PIE_ALLOWED_HOSTS "$allowed_hosts"
}

print_scope() {
  cat <<EOF
scope=$scope
worktree=$worktree_root
home=$home
daemon_dir=$daemon_dir
server_url=http://127.0.0.1:$server_port
app_url=http://localhost:$app_port
desktop_url=http://localhost:$desktop_port
PIE_PORT=$server_port
PIE_APP_PORT=$app_port
PIE_DESKTOP_PORT=$desktop_port
EOF
}

if (($# != 1)); then
  usage
  exit 2
fi

set_dev_values
case "$1" in
  --print) print_scope ;;
  --shell) print_shell ;;
  *)
    usage
    exit 2
    ;;
esac
