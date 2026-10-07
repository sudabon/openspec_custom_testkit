# Proposal

## Why

統合 test-plan の TP は `Fixture` 列で前提状態を名乗るが、その名前が `tests/e2e/fixtures/README.md` に登録され、どんな状態を作るかが読めることは検査していない。外部 SaaS のモックも、どの契約に基づき、いつ実物と照合したかの記録がない。このため QA は「E2E は Green だが、前提データやモックが実際と合っているか」を本番相当環境で手作業で確認し直している。登録と鮮度を機械的に検査し、QA がこの再確認を省ける根拠を提供する。

## What Changes

- fixture README の記述「test-plan.md の『前提(fixture)』列」を、統合 schema の `Fixture` 列と旧 `spec-driven-e2e` の `前提(fixture)` 列の両方を指す記述に直す。
- 統合 schema の plan gate で、TP の `Fixture` 列にある fixture 名が E2E ルート（`installedE2eRoot`）の `fixtures/README.md` に登録され、その行の「使用する TP-ID」に `<change-id>:TP-NNN` が載っていることを検査する。未登録・未記載は失敗にする。
- `tests/e2e/mocks/README.md` を新設し、モック名、対象サービス、契約の出典、整合の確認方法、最終確認日を登録する。TP は `Fixture` 列に `mock:<name>` と書いてモックの使用を宣言し、同じ登録検査を受ける。
- final gate で、使用モックの最終確認日が policy の `mock_contract_max_age_days` 以内であることを検査する。CI の任意入力 `contract-command` を追加し、指定時だけ実行して run 記録に残す。既定では外部サービスへ送信しない。
- fixture の冪等性と独立性は機械検査せず、E2E 規約と Human Code Review の観点として明記する。

## Capabilities

### New Capabilities

- `e2e-test-data-registry`: E2E の fixture とモックの登録、TP からの参照検査、モック契約の鮮度と任意の契約テスト実行。

### Modified Capabilities

なし。既存 capability の要件は変更しない。

## Impact

- 変更対象: `payload/scripts/lib/plan-check.mjs`（登録検査の追加）、`payload/scripts/lib/evidence-check.mjs` または final 検査、`payload/scripts/ci-job.mjs` と `.github/workflows/openspec-custom-testkit-gate.yml`（`contract-command`）、`payload/tests/e2e/fixtures/README.md`、新規 `payload/tests/e2e/mocks/README.md`、`payload/openspec/quality-policy.md`、`payload/openspec/schemas/quality-driven-e2e/`（test-plan instruction と template）、`payload/.claude/skills/e2e-conventions/SKILL.md`、`docs/workflow.md`、`docs/migration.md`、`test/`。
- 導入先の fixture README は利用者が編集する seed であり、既知の未編集版だけを更新する。編集済みのものは保持し、移行案内を出す（`safe-kit-installation` の既存規則に従う）。
- 旧 `spec-driven-e2e` の change は失敗にせず警告だけにする。旧 `quality-driven` は対象外。
- 他 change との関係: `add-e2e-convention-lint` はモックをテストファイルに直書きする違反を検出する側で、本 change は登録と鮮度を扱う。`add-regression-coverage-map` が archive 後の TP の恒久的な識別を決める場合、登録表の `<change-id>:TP-NNN` 表記はそれに合わせて読み替えられるようにする。`add-qa-handoff` は、鮮度切れを Residual として QA へ渡す入力に使える。
