---
name: qe-oracle
description: 指定した change の Oracle テストを、実装とは別コンテキストの qe-oracle-writer で作成する。人間が /qe-oracle <change> で起動する。
argument-hint: <change-name>
disable-model-invocation: true
context: fork
agent: qe-oracle-writer
---

対象 change: `$ARGUMENTS`

change 名が空、または `openspec/changes/$ARGUMENTS/` が存在しない場合は、`openspec list` の結果を示して何も作成せずに終了してください。

`openspec/roles/oracle-writer.md` に従い、次だけを入力にして Oracle テストを作成してください。

- `openspec/changes/$ARGUMENTS/specs/**/*.md`
- `openspec/changes/$ARGUMENTS/quality.md`
- `openspec/quality-policy.md`

公開インターフェースの型・スキーマは必要に応じて参照し、`design.md`・実装本体・過去の実装会話は参照しないでください。

`quality.md` の `oracle_paths` 配下にテストを作成し、次を報告してください。

- Oracle ID とテスト名の対応
- RED の理由
- 未解決事項（書けない Oracle の修正提案を含む）

承認欄の編集と seal の実行はしないでください。
