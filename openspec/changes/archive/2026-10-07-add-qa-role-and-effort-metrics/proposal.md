# Proposal

## Why

統合 schema は全 Risk で人間の承認・seal・反証を求めるが、`quality-policy.md` の役割表は「人間」を一括りにしており、QA エンジニアがいつ何を見るかが決まっていない。QA のテスト設計の知見（同値分割・境界値・デシジョンテーブル・状態遷移など）が quality.md に入らないまま実装が進むと、後工程で QA が手動テストをやり直すことになり、kit 導入の目的である QA 工数の削減が達成されない。また、工数が QA からレビュー担当へ移っただけなのかを確かめる手段もない。

## What Changes

- `quality-policy.md` の役割表で人間の役割を分け、QA レビュー担当を定義する。QA レビューを必須にする Risk Level を policy で設定できるようにする。統合 schema の全 Risk 必須の人間承認・seal・反証は弱めない。
- quality.md frontmatter に `qa_reviewed_by` / `qa_reviewed_at` を追加する。既存の承認欄と同じく人間専用で、Agent は記入しない。policy で必須とした Risk Level では、seal と plan gate が QA レビュー済みを要求する。
- QA レビュー用のテスト設計チェックリストを `openspec/roles/qa-reviewer.md` として配布する。
- evidence の Execution Records に任意の `effort` 記録（活動ごとの所要分）を追加し、archive 済み change から集計する `testkit-gate.mjs effort` コマンドを提供する。未記入は 0 分ではなく「未記録」として扱う。
- `CODEOWNERS.example` に QA 担当の割り当て例を追加する。

## Capabilities

### New Capabilities

- `qa-review-role`: QA レビュー担当の定義、QA レビュー記録と必須条件、テスト設計チェックリスト、人間の検証工数の記録と集計。

### Modified Capabilities

なし。既存 capability の要件は変更しない。統合 schema の人間ゲート（`integrated-quality-workflow` の Human gates for every integrated risk level）はそのまま維持し、QA レビューはその上に追加する条件として新 capability に定義する。

## Impact

- 対象: `payload/openspec/quality-policy.md`、`payload/openspec/roles/qa-reviewer.md`（新規）、`payload/openspec/schemas/quality-driven-e2e/templates/quality.md` と `evidence.md`、schema の quality / apply instruction、`payload/scripts/qe-gate.mjs`、`payload/scripts/lib/evaluate.mjs`、`payload/scripts/lib/evidence-check.mjs`、`payload/scripts/lib/policy.mjs`、`payload/scripts/testkit-gate.mjs`、`payload/.github/CODEOWNERS.example`、`docs/workflow.md`、`docs/migration.md`、`test/`。
- 旧 `quality-driven` / `spec-driven-e2e` schema と進行中 change には新欄を要求しない。新欄が無い既存の統合 change は、policy が QA レビューを必須にしない限り従来どおり通る。
- `oracle_digest` は `oracle_paths` 配下のファイルだけを対象にするため、quality.md frontmatter への欄追加は digest を変えない。
- 関連 change: `add-qa-handoff` は Manual 層の実施結果を QA が記入する。本 change の `effort` の `manual-test` 活動はその所要分を記録する先になる。両方を archive する順序は問わないが、`qa-handoff.md` の結果欄と `effort` の記録先が二重にならないよう、`add-qa-handoff` では所要分を `effort` に寄せる。`add-regression-coverage-map` と `add-nonfunctional-test-viewpoints` はチェックリストの観点（回帰範囲・非機能観点）と重なるため、チェックリストはそれらの成果物を参照する形にする。
- 対象外: QA 担当者の本人確認（CODEOWNERS とブランチ保護に依存する点は既存の承認欄と同じ）、導入前の手動テスト工数との自動比較、外部の工数管理システムとの連携。
