#!/usr/bin/env bash
# tests/e2e は導入時に E2E root へ置換される既定値。実体の探索は Node 側。
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
exec node "$dir/check-test-plan.mjs" "$@"
