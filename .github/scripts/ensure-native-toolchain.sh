#!/usr/bin/env bash
# node-pty 1.1.0 ships darwin/win32 prebuilds only. Linux compiles from source
# the same way t3code builds its WSL pty.node — no third-party pty fork.
set -euo pipefail

if command -v make >/dev/null && { command -v g++ >/dev/null || command -v clang++ >/dev/null; }; then
  exit 0
fi

if command -v apt-get >/dev/null && command -v sudo >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends build-essential python3
  exit 0
fi

echo "Linux node-pty needs make and a C++ compiler (no published linux prebuild)." >&2
exit 1
