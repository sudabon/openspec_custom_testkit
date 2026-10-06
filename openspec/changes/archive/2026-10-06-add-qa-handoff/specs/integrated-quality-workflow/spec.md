# Spec Delta

## ADDED Requirements

### Requirement: Task sequence ends with a QA handoff
統合 schema の tasks instruction は、Evidence グループのあとに `## 6. QA Handoff` グループを置くよう指示しなければならない（SHALL）。このグループは qa-handoff.md を evidence と quality.md から作るタスクと、QA が実施結果を記入するタスクを持つ。後者には「人間が実施。Agent は記入しない」と書く。handoff が不要な change では、その理由（Manual 層なし・Residual なし）を書いたタスク1件にしなければならない（MUST）。番号 2 以降の完了を実装開始とみなす既存の判定を変えてはならない（MUST NOT）。

#### Scenario: Handoff task counts as an implementation start before seal
- **WHEN** seal 前に `## 6. QA Handoff` のタスクだけが完了にされている
- **THEN** 既存の seal 検査どおり、実装開始として扱われて失敗する

#### Scenario: Change needs no handoff
- **WHEN** Manual 層も Residual も無い change の tasks を作る
- **THEN** `## 6. QA Handoff` には、不要な理由を書いたタスクが1件だけ置かれる
