# Proposal

## Why

統合 schema `quality-driven-e2e` の Failure Modes 観点は境界値・冪等性・認可など機能ロジック寄りで、手動QAが時間を使うクロスブラウザ、見た目、アクセシビリティ、文言、性能、入力系セキュリティを計画段階で検討させる仕組みがない。検討されない観点は自動化されず、最終的に QA エンジニアが手作業で確認することになるため、計画時に割り当てるか対象外の理由を残させ、自動化できる観点は E2E 等で観測できるようにする。

## What Changes

- `quality-driven-e2e` の quality instruction とテンプレートに `## Non-functional Viewpoints` 表を追加する。対象観点は、クロスブラウザ／デバイス／レスポンシブ、見た目の回帰、アクセシビリティ、文言・多言語、性能、入力系セキュリティ（XSS 等）の6つとする。
- UI に触れる change（判定は design 参照）では、6観点すべてに Failure Mode ID を割り当てるか「該当なし(理由)」を書かせ、計画ゲートで欠落を拒否する。UI に触れない change は表全体を「該当なし(UI 変更なし)」で済ませられる。
- test-plan の `## E2E観点一覧` に任意の `Projects` 列（Playwright project 名のカンマ区切り）を追加する。値があるTPは、指定した全 project で実 attempt の pass がある場合だけ coverage に数える。列が無い、または空欄の既存 plan は従来どおり扱う。
- `playwright.config.example.ts` に複数 project（chromium / webkit / モバイル端末）の例を、`e2e-conventions` SKILL に `toHaveScreenshot` と `@axe-core/playwright` の規約を追加する。導入先へ依存を追加しない。
- Test Layer は増やさない。手動確認の層は `add-qa-handoff` が追加する。

## Capabilities

### New Capabilities

- `nonfunctional-test-viewpoints`: 非機能観点を quality で必ず検討させ、割当か理由付きの対象外を計画ゲートで検査する。自動化の規約と設定例も配布する。

### Modified Capabilities

- `e2e-plan-reporting`: `Projects` 列による project 単位の実行照合を ADDED Requirement として追加する。既存 Requirement は変更しない。

## Impact

- 対象: `payload/openspec/schemas/quality-driven-e2e/schema.yaml`（quality / test-plan instruction）、同 `templates/quality.md`・`templates/test-plan.md`、`payload/scripts/lib/plan-check.mjs`、`payload/scripts/lib/report.mjs`、`payload/playwright.config.example.ts`、`payload/.claude/skills/e2e-conventions/SKILL.md`、`test/`、`docs/workflow.md`。
- 旧 `quality-driven` / `spec-driven-e2e` schema と既存の進行中 change には新しい表を要求しない。表の検査は統合 schema で、その表を持つテンプレート版以降に作られた change に限る（design 参照）。
- 他 change との関係: `add-qa-handoff` が追加する `Manual` 層は、自動化できない観点（例: 見た目の主観評価）の割当先になる。`add-e2e-convention-lint` は本 change が追加する規約（`toHaveScreenshot` の閾値指定など）を静的検査の対象に含められる。`add-e2e-result-publishing` の結果表示は project 列を表示できるとよい。`add-flaky-management` とは、複数 project でのフレーク集計で重なる。
- 対象外: 性能の負荷試験基盤、セキュリティスキャナの同梱、見た目のベースライン画像の保管方式。
