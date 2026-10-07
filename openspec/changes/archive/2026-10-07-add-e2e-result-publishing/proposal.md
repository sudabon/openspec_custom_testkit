# Proposal

## Why

CI の E2E 結果は、ジョブログの Markdown 表と `test-results/testkit/` の artifact にしか残らない。evidence.md も機械照合用の JSON が中心である。QA や承認者は、どの TP がどの project で通り、失敗時に何が起きたかを PR から辿れない。結局手元で再現して確かめることになり、QA 工数が減らない。CI 結果を人が読める形で PR に出し、再現せずに確認できるようにする。

## What Changes

- `e2e-report` に人向けの出力形式 `--format summary` を追加する。TP-ID、テスト名、project、結果、フレーク、添付（Playwright JSON の attachments にある trace / screenshot / video の相対パス）を表で出す。引数を省略したときの標準出力と終了コード 0/1/2/3 は変えない。
- reusable workflow が、各 change の summary を `$GITHUB_STEP_SUMMARY` に書き出す。Playwright HTML レポートと今回の実行の test-results を artifact として保存し、summary に artifact とワークフロー実行へのリンクを出す。
- PR コメントへの投稿を任意入力 `publish-pr-comment`（既定 `false`）として追加する。権限不足（fork PR など）は警告にとどめ、ゲート結果に影響させない。
- 公開処理は失敗時も実行する。公開処理の失敗はゲートの終了コードを変えない。ゲートやテストの失敗は、公開処理の成否に関係なく最終 job に伝わる。
- artifact の保持期間を入力 `artifact-retention-days` で指定できるようにする。添付に個人情報などが写るおそれについて、利用者向けの注意を文書化する。

## Capabilities

### New Capabilities

- `e2e-result-publishing`: E2E 実行結果の人向け要約、添付の参照、GitHub への公開（step summary、artifact、任意の PR コメント）、公開処理とゲート結果の分離、機微情報と保持期間の扱い。

### Modified Capabilities

なし。既存の `e2e-plan-reporting`（終了コードと鮮度）と `ci-distribution-contract`（失敗の伝達）の要件は変えず、新 capability がそれに従う。

## Impact

- 対象: `payload/scripts/lib/report.mjs`、`payload/scripts/e2e-report.mjs`、`payload/scripts/ci-job.mjs`、`.github/workflows/openspec-custom-testkit-gate.yml`、`payload/playwright.config.example.ts`（HTML reporter の出力先）、`examples/ci/README.md`、`docs/workflow.md`、`test/`。
- 互換: 既存の `e2e-report <change-id> [results.json] [--max-age]` の出力と終了コード、workflow の既存入力と既存 artifact 名 `testkit-results` は維持する。
- 権限: PR コメントを有効にした呼び出し側は、`pull-requests: write` を付ける必要がある。既定の構成では新しい権限を要求しない。
- 他 change との関係:
  - `add-flaky-management`: フレーク判定の方針を決める。本 change はその判定結果を表示するだけで、方針は持たない。
  - `add-nonfunctional-test-viewpoints`: TP の `Projects` 列を追加する。本 change の project 列は Playwright JSON の実行結果を表示するもので、計画上の Projects との照合は行わない。
  - `add-qa-handoff`: qa-handoff.md から、本 change の summary と artifact を参照できる。
  - `add-regression-coverage-map`: 対応表の結果表示に、同じ summary 形式を流用できる。
- 対象外:
  - 外部ストレージやダッシュボードへの公開
  - 実行をまたいだ結果履歴の蓄積
  - 添付ファイルのマスキングや自動削除
  - GitHub 以外の CI での公開