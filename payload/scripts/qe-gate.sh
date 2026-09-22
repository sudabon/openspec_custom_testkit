#!/usr/bin/env bash
# Thin bash 3.2 entry. Aggregation and hashing live in Node.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
exec node "$dir/qe-gate.mjs" "$@"
