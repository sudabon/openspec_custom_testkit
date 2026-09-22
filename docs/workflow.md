# ワークフロー

## 人間が行うこと

統合 schema では low を含むすべての Risk で、次を人間が行う。

1. `quality.md` の `approved_by` と `approved_at`（YYYY-MM-DD）を記入する。
2. Oracle を読んで `scripts/qe-gate.sh seal <change>` を実行する。
3. 反証の Residual を承認する。medium 以上は Human Code Review、high はドメイン担当を含める。

Agent は承認欄、`oracle_digest`、seal を埋めない。apply の指示は、未承認または未 seal のとき実装を止める。`scripts/qe-gate.sh seal` は本人確認をしない。誰が実行したかの保証は CODEOWNERS とブランチ保護に依存する。

役割の入力範囲は `openspec/roles/oracle-writer.md` と `openspec/roles/falsifier.md` が正本である。Claude の adapter は `.claude/agents/` からその定義を参照する。design と実装会話は Oracle の期待値に渡さない。別セッションを起動できない環境では、同じ会話の続きで Oracle や反証を書かず、人間に別セッションの開始を依頼して止まる。

E2E 層の Oracle は test-plan の TP で観測する。同じ観測を単体テストとして再実装しない。Unit 層の Oracle に TP-ID は不要である。

## 計画と適用

`skip_specs: true` のとき specs は skipped になり、架空の spec は作らない。quality と test-plan は proposal と変更範囲から書く。OpenSpec 1.13.1 では、skipped な specs のあと quality は ready になる。tasks まで揃うと、evidence が無くても apply は ready になる。

全タスク完了、または archive へ移した change は、CI の `gate-phase` が plan でも final として検査する。
