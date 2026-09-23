#!/usr/bin/env bash
# qe-gate.sh — quality-driven スキーマの決定的ゲート
#
# OpenSpec は artifact の「存在」しか確認しない。承認・Oracle改変・証跡の有無は
# プロンプトではなくこのスクリプト(CI)で強制する。
#
# Usage:
#   scripts/qe-gate.sh seal   <change>             Oracleテストのダイジェストを quality.md に記録(人間が実行)
#   scripts/qe-gate.sh digest <change>             現在のOracleダイジェストを表示
#   scripts/qe-gate.sh check  [--base <ref>] [<change>...]
#       --base 指定時: base...HEAD の差分に含まれる change だけを検査
#       指定なし:     すべての active change を検査
#
# Env:
#   QE_SCHEMA               対象スキーマ名(default: quality-driven)
#   QE_SEAL_REQUIRED_LEVELS seal を必須とする risk_level(default: "medium high")
set -euo pipefail

QE_SCHEMA="${QE_SCHEMA:-quality-driven}"
QE_SEAL_REQUIRED_LEVELS="${QE_SEAL_REQUIRED_LEVELS:-medium high}"
CHANGES_DIR="openspec/changes"
DONE_BOX='- \[ *[xX] *\]'
OPEN_BOX='- \[ *\]'

fail_count=0
max_level="none"

err()  { echo "  ✗ $*"; fail_count=$((fail_count + 1)); }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }

# --- frontmatter helpers -----------------------------------------------------

frontmatter() { awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1{print}' "$1"; }

fm_get() { # fm_get <file> <key>  -> scalar value (quotes/comments stripped)
  frontmatter "$1" | awk -v k="$2" '
    $0 ~ "^"k":" {
      sub("^"k":[ \t]*", ""); sub(/[ \t]+#.*$/, "")
      gsub(/^["\x27]|["\x27]$/, ""); print; exit
    }'
}

fm_list() { # fm_list <file> <key> -> one item per line (block or inline [a, b])
  frontmatter "$1" | awk -v k="$2" '
    $0 ~ "^"k":" {
      rest=$0; sub("^"k":[ \t]*", "", rest); sub(/[ \t]+#.*$/, "", rest)
      if (rest ~ /^\[/) {
        gsub(/[\[\]"\x27]/, "", rest); n=split(rest, a, ",")
        for (i=1;i<=n;i++){ gsub(/^[ \t]+|[ \t]+$/, "", a[i]); if (a[i]!="") print a[i] }
        exit
      }
      inlist=1; next
    }
    inlist && /^[ \t]+-[ \t]*/ { v=$0; sub(/^[ \t]+-[ \t]*/, "", v); sub(/[ \t]+#.*$/, "", v); gsub(/["\x27]/, "", v); print v; next }
    inlist { exit }'
}

fm_set() { # fm_set <file> <key> <value>  (frontmatter内の既存キーを置換)
  local tmp; tmp="$(mktemp)"
  awk -v k="$2" -v v="$3" '
    NR==1 && $0=="---" { infm=1; print; next }
    infm && $0=="---"  { infm=0; print; next }
    infm && $0 ~ "^"k":" { print k": \""v"\""; next }
    { print }' "$1" > "$tmp" && mv "$tmp" "$1"
}

# --- core --------------------------------------------------------------------

change_schema() {
  local dir="$1" s=""
  [[ -f "$dir/.openspec.yaml" ]] && s="$(awk -F': *' '$1=="schema"{print $2; exit}' "$dir/.openspec.yaml")"
  [[ -z "$s" && -f openspec/config.yaml ]] && s="$(awk -F': *' '$1=="schema"{print $2; exit}' openspec/config.yaml)"
  echo "${s:-spec-driven}"
}

sha256_files() { if command -v sha256sum >/dev/null 2>&1; then xargs -0 sha256sum; else xargs -0 shasum -a 256; fi; }

oracle_digest() { # oracle_digest <quality.md>  -> パス名と内容の両方を含むダイジェスト
  local q="$1" paths=() p
  while IFS= read -r p; do [[ -n "$p" ]] && paths+=("${p%/}"); done < <(fm_list "$q" oracle_paths)
  [[ ${#paths[@]} -eq 0 ]] && { echo ""; return; }
  for p in "${paths[@]}"; do [[ -e "$p" ]] || { echo "MISSING:$p"; return; }; done
  echo "sha256:$(find "${paths[@]}" -type f -print0 | LC_ALL=C sort -z | sha256_files | sha256 | awk '{print $1}')"
}

level_rank() { case "$1" in high) echo 3;; medium) echo 2;; low) echo 1;; *) echo 0;; esac; }
bump_level() { [[ $(level_rank "$1") -gt $(level_rank "$max_level") ]] && max_level="$1"; return 0; }

check_active() {
  local name="$1" dir="$CHANGES_DIR/$1" q="$CHANGES_DIR/$1/quality.md" t="$CHANGES_DIR/$1/tasks.md"
  echo "▶ $name (active)"
  local has_tasks=0 impl_started=0
  [[ -f "$t" ]] && has_tasks=1
  # グループ2以降のタスクが1つでも完了 = 実装フェーズに入った
  [[ $has_tasks -eq 1 ]] && grep -Eq "^[[:space:]]*${DONE_BOX}[[:space:]]+([2-9]|[1-9][0-9]+)\." "$t" && impl_started=1

  if [[ ! -f "$q" ]]; then
    if [[ $has_tasks -eq 1 ]]; then err "quality.md がないまま tasks.md が作成されています"; else warn "計画段階(quality.md 未作成)"; fi
    return
  fi

  local level approved digest_rec digest_now
  level="$(fm_get "$q" risk_level)"
  approved="$(fm_get "$q" approved_by)"
  digest_rec="$(fm_get "$q" oracle_digest)"

  case "$level" in high|medium|low) ok "risk_level: $level"; bump_level "$level";;
    *) err "risk_level が不正です: '${level}'(high|medium|low)";; esac

  if [[ -n "$approved" ]]; then ok "承認済み: $approved"
  elif grep -Eq "^[[:space:]]*${DONE_BOX}" "$t" 2>/dev/null; then err "quality.md が未承認のままタスクが進行しています(approved_by が空)"
  else warn "quality.md 未承認(実装開始前に人間の承認が必要)"; fi

  digest_now="$(oracle_digest "$q")"
  if [[ "$digest_now" == MISSING:* ]]; then
    [[ $impl_started -eq 1 || -n "$digest_rec" ]] && err "oracle_paths が存在しません: ${digest_now#MISSING:}" || warn "Oracle未作成: ${digest_now#MISSING:}"
  elif [[ -n "$digest_rec" ]]; then
    if [[ "$digest_rec" == "$digest_now" ]]; then ok "Oracle は seal 時から変更されていません"
    else err "seal 後に Oracle が変更されています(人間が確認のうえ再 seal し、evidence.md の Oracle Changes に記録)"; fi
  elif [[ " $QE_SEAL_REQUIRED_LEVELS " == *" $level "* && $impl_started -eq 1 ]]; then
    err "risk_level=$level では実装開始前に Oracle の seal が必要です"
  elif [[ -n "$digest_now" ]]; then
    warn "Oracle は未 seal です"
  fi
}

check_archived() {
  local dir="$1" name; name="$(basename "$1")"
  echo "▶ $name (archived)"
  [[ -f "$dir/quality.md" ]] && bump_level "$(fm_get "$dir/quality.md" risk_level)"
  if grep -Eq "^[[:space:]]*${OPEN_BOX}" "$dir/tasks.md" 2>/dev/null; then err "未完了タスクが残っています"; else ok "全タスク完了"; fi
  if [[ ! -f "$dir/evidence.md" ]]; then err "evidence.md がありません"; return; fi
  ok "evidence.md あり"
  if [[ -f "$dir/quality.md" ]]; then
    local missing=()
    while IFS= read -r rid; do grep -qw "$rid" "$dir/evidence.md" || missing+=("$rid"); done \
      < <(grep -oE '^\|[[:space:]]*R[0-9]+' "$dir/quality.md" | grep -oE 'R[0-9]+' | sort -u)
    if [[ ${#missing[@]} -eq 0 ]]; then ok "全 Risk ID が evidence.md に記載されています"
    else err "evidence.md に記載のない Risk ID: ${missing[*]}"; fi
  fi
}

cmd_check() {
  local base="" targets=() archived=()
  while [[ $# -gt 0 ]]; do
    case "$1" in --base) base="$2"; shift 2;; *) targets+=("$1"); shift;; esac
  done

  if [[ ${#targets[@]} -eq 0 && -n "$base" ]]; then
    local files; files="$(git diff --name-only "$base"...HEAD -- "$CHANGES_DIR")"
    while IFS= read -r n; do [[ -n "$n" ]] && targets+=("$n"); done < <(
      echo "$files" | awk -F/ '$3!="archive" && NF>3 {print $3}' | sort -u)
    while IFS= read -r n; do [[ -n "$n" ]] && archived+=("$CHANGES_DIR/archive/$n"); done < <(
      echo "$files" | awk -F/ '$3=="archive" && NF>4 {print $4}' | sort -u)
  elif [[ ${#targets[@]} -eq 0 ]]; then
    for d in "$CHANGES_DIR"/*/; do n="$(basename "$d")"; [[ "$n" != archive ]] && targets+=("$n"); done
  fi

  local checked=0
  for n in "${targets[@]+"${targets[@]}"}"; do
    [[ -d "$CHANGES_DIR/$n" ]] || continue
    [[ "$(change_schema "$CHANGES_DIR/$n")" == "$QE_SCHEMA" ]] || continue
    check_active "$n"; checked=$((checked + 1))
  done
  for d in "${archived[@]+"${archived[@]}"}"; do
    [[ -d "$d" ]] || continue
    [[ "$(change_schema "$d")" == "$QE_SCHEMA" ]] || continue
    check_archived "$d"; checked=$((checked + 1))
  done

  echo "---"
  echo "checked: $checked change(s), max risk_level: $max_level, failures: $fail_count"
  [[ -n "${GITHUB_OUTPUT:-}" ]] && echo "risk_level=$max_level" >> "$GITHUB_OUTPUT"
  [[ $fail_count -eq 0 ]]
}

cmd_seal() {
  local q="$CHANGES_DIR/${1:?change name required}/quality.md" d
  [[ -f "$q" ]] || { echo "not found: $q" >&2; exit 1; }
  [[ -n "$(fm_get "$q" approved_by)" ]] || { echo "quality.md が未承認です。approved_by を記入してから seal してください" >&2; exit 1; }
  d="$(oracle_digest "$q")"
  [[ -n "$d" && "$d" != MISSING:* ]] || { echo "Oracle テストが見つかりません: ${d#MISSING:}" >&2; exit 1; }
  fm_set "$q" oracle_digest "$d"
  echo "sealed: $1 → $d"
}

case "${1:-}" in
  check)  shift; cmd_check "$@";;
  seal)   shift; cmd_seal "$@";;
  digest) shift; oracle_digest "$CHANGES_DIR/${1:?change name required}/quality.md";;
  *) sed -n '2,18p' "$0"; exit 2;;
esac
