# Tasks

## 1. Oracle

実装とは別コンテキストで実施する。入力は specs と quality.md と role 定義だけ。E2E 層の Oracle をここで再実装しない。

- [ ] 1.1 非 E2E の Oracle を oracle_paths に実装し、未実装のため RED になることを確認する
- [ ] 1.2 人間が Oracle をレビューし `scripts/qe-gate.sh seal <change>` を実行する。Agent は実行しない

## 2. Implementation

- [ ] 2.1 実装と fixture を追加し、対応する非 E2E Oracle が GREEN になることを確認する

## 3. E2E

E2E Oracle を別テストとして重複実装しない。not-applicable の change では代替検証を実行する。

- [ ] 3.1 test-plan の各 TP を `@<change-id>` と `@TP-NNN` 付きで実装し、reporter の coverage になることを確認する

## 4. Falsification

- [ ] 4.1 別コンテキストで反証し、反例を修正するか人間承認済み Residual にする
- [ ] 4.2 high なら Mutation を実行し、policy の閾値（最低 70%）以上であることを確認する。medium/high は Human Code Review を記録する

## 5. Evidence

- [ ] 5.1 evidence.md の追跡表と Execution Records が全 Risk で一致し、構造確認と実行確認を分けて記録する
