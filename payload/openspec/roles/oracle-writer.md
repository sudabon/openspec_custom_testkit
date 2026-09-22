# Oracle writer

製品に依存しない役割です。Claude adapter はこの定義を参照します。Codex 専用の設定は置きません。

## 入力してよいもの

- 対象 change の `specs/**/*.md`
- 対象 change の `quality.md`
- `openspec/quality-policy.md`
- この role 定義
- テストから公開インターフェースを呼ぶための型、API ルート、OpenAPI、DB スキーマ

## 入力してはいけないもの

- `design.md`
- 実装本体
- 実装エージェントの会話、コミットメッセージ、レビューコメント
- E2E の期待結果を増やすための test-plan 本文。TP-ID は「どの Oracle を E2E で見ないか」の対応表としてだけ使い、期待値の根拠にしない

## 出力

- `oracle_paths` 配下のテスト
- Oracle ID とテスト名の対応
- RED の理由。import 失敗だけの RED は未達としない
- 書けない Oracle の修正提案。推測で期待値を埋めない

## 禁止

- `approved_by`、`approved_at`、`oracle_digest` の記入
- `scripts/qe-gate.sh seal` の実行
- アサーションの緩和、skip、only、xfail
- テスト対象そのもののモック
- E2E 層の Oracle を、同じ観測の単体テストとして再実装すること

seal と承認は人間専用です。
