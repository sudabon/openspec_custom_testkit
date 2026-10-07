# Proposal

## Why

`payload/scripts/` では、同じ判定や同じ定数が複数のモジュールにそれぞれ実装されている。

| 重複しているもの | 箇所の数 |
|---|---|
| `.openspec.yaml` の mapping 検証 | 5か所 |
| archive フォルダ名（`YYYY-MM-DD-id`）の正規表現 | 4か所 |
| `openspec/quality-policy.md` のパスと読み込み | 6か所 |
| TP-ID の正規表現 | 7か所 |
| `change.e2e === 'required' \|\| change.schema === SCHEMA_E2E` | 4か所 |
| `isIntegratedChange` の再実装 | 3か所 |

このうち一部は、すでに実装ごとに挙動がずれている。新しい規則を足すたびに、どこを直せばよいかを探す手間がかかり、直し漏れも起きやすい。後続の `split-long-gate-functions` で長い関数を分割する前に、共通の部品を1か所にまとめておく。

## What Changes

- 共通モジュールを新しく作り、同じ処理をまとめる。
  - `payload/scripts/lib/changes.mjs`: archive フォルダ名の分解、active / archive の change 一覧
  - `payload/scripts/lib/change-metadata.mjs`: `.openspec.yaml` と config の schema 解釈、`quality.md` の `risk_level` の読み込み
  - `payload/scripts/lib/ids.mjs`: TP-ID の正規表現
- 既存モジュールに共通の定数と helper を足す。
  - `critical.mjs`: `isE2eRequired(change)`
  - `policy.mjs`: `POLICY_PATH`、`readPolicyText(repo)`、キー行パーサの共通部分
  - `frontmatter.mjs`: `isPlainMapping(parsed)`、`isCustomTag(node)`
  - `markdown.mjs`: `escapeRegExp`、`markdownCell` / `escapeHtml`、節見出しの定数、`scenarioCell(row)`
- 小さな重複を共通化する。対象は `isRecord`、`utcDate`、`norm`、`placeholder`、`err.code ?? err.message`、`gitShow` と `git` の重複、fs エラーの判定。
- エントリポイント（`qe-gate`、`testkit-gate`、`e2e-report`、`check-test-plan`、`ci-job`）で重複している処理を `payload/scripts/lib/entry.mjs` にまとめる。対象は repo の解決、`GITHUB_OUTPUT` への追記、`{stdout, stderr, exitCode}` の出力。
- **挙動は変えない**。実装ごとに挙動が違う箇所は、呼び出し元ごとに今の挙動を保つ引数を渡す。挙動をそろえる修正はこの change では行わない（design.md の「保留した不一致」を参照）。
- 新しく作るモジュールは `scripts/lib/` 配下なので、`REQUIRED_MODULES` への追加が必要か判断し、必要なら更新する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。内部構造の整理だけで、利用者から見える挙動（ゲートの判定、終了コード、メッセージ）は変わらないため `skip_specs: true` とする。

## Impact

- 対象: `payload/scripts/*.mjs` と `payload/scripts/lib/*.mjs`（vendor を除く）、`lib/cli.mjs`（`SCHEMA_NAME` や `POLICY_PATH` の直書きを置き換える）、`test/distribution.test.mjs`（pack に含めるファイルの一覧）。
- 配布物の構成が変わる: `scripts/lib/` 配下に新しいファイルが増える。
  - kit を更新すると、導入先にも新しいファイルが配置される。
  - 古い stamp を持つ導入先の doctor 判定は `REQUIRED_MODULES` の扱いに従う。
- 前提: `add-refactor-safety-net` が archive 済みで、テスト helper の集約が終わっていること。
- 対象外: 長い関数の分割（`split-long-gate-functions`）、`e2e-lint.mjs` のファイル分割（`split-e2e-lint-module`）、挙動の不一致の修正。
