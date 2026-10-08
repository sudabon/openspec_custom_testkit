# derived-schema fixture

`change/` は派生 schema `quality-driven-e2e-mockup` の change です。統合 schema の6 artifact に加えて、派生 schema だけの `mockup-plan.md` と `## 7. Mockup` タスクグループを持ちます。

- quality.md は未承認（`approved_by` が空）で、tasks の 1.1 と 2.1 が完了しています。計画ゲートは承認の欠落で失敗します。
- schema 自体（`openspec/schemas/quality-driven-e2e-mockup/`）は置いていません。テストが `test/support.mjs` の `writeDerivedSchema` で、配布中の統合 schema から毎回作ります。統合 schema が変わっても fixture がずれないようにするためです。
- `.openspec.yaml` の `schema` だけを差し替えると、同じ内容の統合 change として比較に使えます。
