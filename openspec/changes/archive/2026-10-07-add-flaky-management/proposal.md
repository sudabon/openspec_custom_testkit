# Proposal

## Why

同梱の `playwright.config.example.ts` は `retries: 1` で、reporter はリトライ後に成功した flaky を pass として coverage に数える。フレークの扱いを Risk に応じて厳しくする手段も、壊れたテストを期限付きで外す手段もない。そのため CI が Green でも、QA は「たまたま通っただけではないか」を手で確認し直すことになり、自動テストの結果を QA の確認範囲から外す根拠にならない。

## What Changes

- `openspec/quality-policy.md` に機械可読のフレーク方針を追加する。例は `flaky_fail_levels: [high]`。指定した Level の Risk に紐づく TP が flaky になったら不合格、それ以外は警告として表示する。
- 統合 schema の reporter は、test-plan の TP の Risk 列と quality.md の Risk Register の Level から、TP ごとのフレーク判定を決める。
- E2E ルート配下に隔離リスト `quarantine.md` を導入する。列は TP-ID、change、理由、担当、期限、代替（Oracle ID か Residual ID）。
- 隔離中の TP は coverage に数えない。代替が有効なら欠落扱いにはしないが、「隔離中」として表示する。期限切れ、または代替が無い隔離は失敗とする。
- final ゲートは、隔離の代替が evidence で成立しているかを検査する。代替 Oracle の pass 結果か、承認済み Residual が必要になる。
- 旧 schema（`spec-driven-e2e` / `quality-driven`）の change と、フレーク方針が書かれていない policy では、既存の flaky の扱い（pass として数え、⚠ を表示する）を変えない。

## Capabilities

### New Capabilities

- `flaky-management`: Risk 別のフレーク判定、期限付きの隔離リスト、隔離中 TP の coverage からの除外と代替検証の確認。

### Modified Capabilities

なし。既存 `e2e-plan-reporting` の「Execution result semantics」は方針が無い場合の既定動作として維持し、変更しない。

## Impact

- 対象: `payload/scripts/lib/report.mjs`、`payload/scripts/lib/policy.mjs`、`payload/scripts/lib/evidence-check.mjs`、`payload/scripts/e2e-report.mjs`、`payload/openspec/quality-policy.md`、`payload/.claude/skills/e2e-conventions/SKILL.md`、`payload/tests/e2e/quarantine.md`（新規の雛形）、`test/`、`docs/workflow.md`。
- 終了コードの意味（0/1/2/3）は維持する。方針で不合格にした flaky は「失敗テストあり」の 3 とする。
- `quality-policy.md` は利用者の保護ファイルで、kit は上書きしない。追記の案内は既存の mutation 閾値と同じ方式（doctor が SAMPLE を表示する）にする。
- 関連 change:
  - `add-e2e-result-publishing`: サマリーに隔離中・flaky の TP を載せるとき、本 change の分類を使う。
  - `add-regression-coverage-map`: 隔離中の TP は対応表で「保護なし（隔離中）」として扱う必要がある。
  - `add-qa-handoff`: 隔離中の TP は QA の手動確認範囲の候補になる。
- 対象外: 実行をまたいだフレーク率の蓄積と、自動での隔離・解除（design の Non-Goals を参照）。
