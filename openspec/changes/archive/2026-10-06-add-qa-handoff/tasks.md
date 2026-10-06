# Tasks

本リストは kit 自体を `spec-driven` で実装するためのタスクである。配布する統合 schema の tasks テンプレートとは別物である。

## 1. 失敗ケースの準備

- [x] 1.1 Manual 層の理由欠落、handoff 欠落、F-ID 漏れ、記入例の残り、`fail` の Risk を自動化済みに載せたもの、archive で QA 判定が空のもの、判定が `fail` のものの fixture を作る。完了条件: 各 fixture が現状のゲートでは失敗しない（未実装のため検出されない）ことを、テストの assertion で RED として確認する。

## 2. Manual 層

- [x] 2.1 quality template の Layer 候補と schema の quality instruction に `Manual` と理由必須を追加する。完了条件: テンプレートと instruction の層候補が一致し、`openspec schema validate` が成功する。
- [x] 2.2 plan-check で Manual 行の理由欠落を失敗にし、Manual を E2E 層とみなさないようにする。完了条件: 1.1 の理由欠落 fixture が失敗し、`Unit`+`Manual` と `not-applicable` の組み合わせが層矛盾にならないテストが通る。

## 3. qa-handoff テンプレート

- [x] 3.1 `templates/qa-handoff.md` を4つの表と記入例の印で作る。完了条件: 人間専用欄に Agent 記入禁止の注記があり、テンプレートのままでは未記入と判定されるテストが通る。
- [x] 3.2 tasks instruction に `## 6. QA Handoff` グループと「不要な場合は理由のタスク1件」を追加する。完了条件: schema validate が成功し、seal 前に 6 のタスクだけ完了した fixture が既存の seal 検査で失敗する。

## 4. ゲート

- [x] 4.1 handoff の必要条件（Manual・quality の Residual・evidence の residuals）を判定する関数を実装する。完了条件: 3条件それぞれ単独で必要と判定され、どれも無いときは不要と判定されるテストが通る。
- [x] 4.2 final 検査で handoff の存在、ID 突合、チャーターの空欄、記入例の残り、自動化済み範囲と `pass` の risk_results の一致を検査する。完了条件: 1.1 の該当 fixture がそれぞれ失敗し、正しい handoff の fixture が成功する。
- [x] 4.3 QA 実施結果を、final では警告、archive では必須（実施者・日付・`pass`）にする。完了条件: final で空欄が警告になり、archive で空欄と `fail` がそれぞれ失敗するテストが通る。
- [x] 4.4 旧 `quality-driven` と `spec-driven-e2e` には適用しない。完了条件: Residual のある旧 change の fixture が handoff 理由で失敗しない。

## 5. 文書と配布

- [x] 5.1 `docs/workflow.md`、`docs/migration.md`、`quality-policy.md` に、Manual 層、handoff、人間専用欄、本人確認をしないことを書く。完了条件: 文書レビューで spec の各 Requirement に対応する記述がある。
- [x] 5.2 配布 manifest とパッケージに新しいテンプレートを含める。完了条件: `npm test`、`npm run lint`、`npm pack --dry-run` の一覧に `qa-handoff.md` があり、install の dry-run で配置予定に出る。
