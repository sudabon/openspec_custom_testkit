# E2E 隔離リスト

壊れた E2E テストを、期限と代替検証つきで一時的に外すための一覧です。統合 schema `quality-driven-e2e` の change だけに効きます。kit の install はこのファイルを新規作成するだけで、既存の内容は `--force` でも上書きしません。

- 隔離中の TP は coverage に数えません。テストが実行されて pass しても数えません。reporter は「隔離中」として件数と各行を毎回表示します。
- `Change` は対象 change の ID です。同じ TP-ID でも別の change の行は効きません。
- `期限` は YYYY-MM-DD（UTC の日付）です。当日までは有効で、翌日から期限切れとして欠落（終了コード 1）になります。
- `代替` は、E2E 以外の層で同じ Failure Mode を確かめる Oracle ID（`O1` など）か、evidence.md の `residuals[]` の ID です。final ゲートは、Oracle なら pass の結果、Residual なら承認者と承認日を evidence で確認します。
- 担当・期限・代替のどれかが空の行、`Change` が空の行は隔離として扱わず、欠落として失敗します。
- テストを外すために `test.skip` / `test.fixme` を付けないでください。テストソースは残し、実行からは change と TP の両方のタグで外します（例: `npx playwright test --grep-invert '(?=.*@add-checkout\b)(?=.*@TP-002\b)'`）。`@TP-002` だけで外すと、別の change の同じ TP-ID まで外れます。
- 解除は、テストを直して `--grep-invert` を外し、この表から行を消して行います。pass しても自動では解除しません。
- 詳細は openspec-custom-testkit の docs/workflow.md「フレーク方針と隔離」にあります。

| TP-ID | Change | 理由 | 担当 | 期限 | 代替 |
|-------|--------|------|------|------|------|
