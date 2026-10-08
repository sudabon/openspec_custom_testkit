# Proposal

> この change は `openspec_custom_testkit` リポジトリで apply する前提で起票している。`openspec/changes/add-derived-schema-compatibility/` を testkit リポジトリへ移動してから apply する。

## Why

testkit のゲート（select / check / seal / evidence / coverage / effort）は、schema 名が `quality-driven-e2e` と完全一致する change だけを統合 change として扱う。名前が違う schema は「無関係な schema」として対象外になる（`payload/scripts/lib/critical.mjs` の `isIntegratedChange`、`payload/scripts/lib/select.mjs` の `applicability`）。

OpenSpec 1.13 の schema.yaml には継承（`extends`）が無い。そのため、統合 schema に artifact やタスクを足した派生 schema（例: モックアップ比較アドオンの `quality-driven-e2e-mockup`）を作ると、その change では人間の承認、Oracle seal、独立反証、E2E 計画ゲートがエラーも出さずに外れる。CI で `testkit-gate.mjs check` を走らせても対象外として成功する。アドオン kit が testkit の振る舞いを引き継いだ schema を安全に配布するには、testkit 側に派生 schema を統合 schema として認識させる拡張点が要る。

## What Changes

- 派生 schema が自分のディレクトリに置く宣言ファイル `openspec/schemas/<name>/testkit-compat.json`（`{"extends": "quality-driven-e2e", "compatVersion": 1}`）を定義する。
- 宣言が有効な派生 schema の change は、全ゲートで `quality-driven-e2e` と同じ統合 change として扱う。承認、seal、反証、test-plan、evidence、QA handoff、非機能観点、lint、coverage、effort の検査を、どれも外したり弱めたりしない。
- 宣言は検査を強めるだけで、弱める方向には使えない。次の場合は対象外にせず、失敗させる（fail closed）。
  - 宣言が壊れている。
  - 派生 schema が統合 schema の必須 artifact（proposal / specs / quality / design / test-plan / tasks）を同じ出力と依存で持っていない。
  - 比較元では宣言されていたのに HEAD で消えている。
- 派生 schema に足した artifact やタスクグループは、testkit のゲートでは検査しない。検査はアドオン側の責務。
- 選択結果（`select --json` とゲートの表示）に、宣言上の schema 名と、判定に使った系統（`quality-driven-e2e`）の両方を出す。
- `doctor` が、認識した派生 schema の一覧と宣言の不備を報告する。
- 派生 schema 名や宣言を扱う公開モジュール `scripts/lib/schema-family.mjs` を配布し、アドオンが判定を再利用できるようにする。
- install / update は、派生 schema のディレクトリを変更も削除もしない。既定 schema が宣言済みの派生 schema なら、統合 schema が既定の場合と同じく案内の警告を出さない。

## Capabilities

### New Capabilities
- `derived-schema-compatibility`: 派生 schema の互換宣言の形式と有効条件、統合 change としての扱い、fail closed の条件、doctor と install の扱い、アドオン向け公開モジュール。

### Modified Capabilities
- `change-gate-selection`: 共通の対象判定（Common schema-aware gate selection）で、宣言済みの派生 schema を統合 schema と同じ系統として選ぶ。

## Impact

- 対象リポジトリ: `sudabon/openspec_custom_testkit`
- コード:
  - `payload/scripts/lib/critical.mjs`、`select.mjs`、`evaluate.mjs`、`digest.mjs`、`seal.mjs`、`plan-check.mjs`、`evidence-check.mjs`、`coverage-map.mjs`、`effort.mjs`、`flaky.mjs`、`e2e-lint/repo.mjs`、`doctor.mjs`
  - `payload/scripts/qe-gate.mjs`
  - 新規の `payload/scripts/lib/schema-family.mjs`
  - `lib/cli.mjs`、`lib/config-merge.mjs`
- 配布: `REQUIRED_MODULES` に `scripts/lib/schema-family.mjs` を追加する。旧版のまま導入されたリポジトリでは、doctor が incomplete を報告する。
- 文書: `docs/architecture.md`、`docs/workflow.md`（派生 schema の節）、`README.md`
- 互換性: 宣言の無い独自 schema の扱い（対象外）と、既存の統合 change、旧 schema の挙動は変えない。
- 後続: モックアップ比較アドオン（`openspec_mockup_comparison`）は、この拡張点を含む testkit 版を前提にする。
