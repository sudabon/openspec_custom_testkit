#!/usr/bin/env bash
# E2E root は stamp をもとに Node 側 (scripts/lib/e2e-root.mjs) で解決する。
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
exec node "$dir/check-test-plan.mjs" "$@"
