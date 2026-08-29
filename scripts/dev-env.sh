#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dev_env="$(bash "$script_dir/dev-scope.sh" --shell)"
eval "$dev_env"
