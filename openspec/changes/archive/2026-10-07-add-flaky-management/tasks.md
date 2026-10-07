# Tasks

各タスクは、対応する失敗 fixture を先に作って RED を確認してから実装する。完了条件にある検証を実行するまでチェックしない。

## 1. 方針と判定の基盤

- [x] 1.1 `policy.mjs` に `flaky_fail_levels` の読み取りを追加し、未記載は空集合、不正値はエラーにする。完了条件: 未記載・`[high]`・`[medium, high]`・不正値の 4 例の単体テストが通る。
- [x] 1.2 TP の Level 解決（test-plan の Risk 列 → quality.md の Level、複数 TP は最大値、解決不能は不合格扱い）を実装する。完了条件: 解決成功・Risk 未登録・quality.md 欠落・複数 TP の fixture テストが通る。
- [x] 1.3 doctor の SAMPLE と `payload/openspec/quality-policy.md` にフレーク方針の記載例を追加する。完了条件: 方針の行を足しても既存の doctor 検査（seal・反証・mutation）の結果が変わらないことをテストで確認する。

## 2. reporter のフレーク判定

- [x] 2.1 `buildReport` に Level 別のフレーク判定を追加し、不合格の flaky を終了コード 3 にする。完了条件: 「High risk TP is flaky」「Low risk TP is flaky」「TP level cannot be resolved」「Invalid flaky policy value」の各 Scenario の fixture が通る。
- [x] 2.2 方針なしと旧 schema の互換を確認する。完了条件: 既存の reporter テスト（flaky 表示、終了コード 0/1/2/3）が無変更で通り、「Policy without flaky settings」「Legacy E2E change」の fixture が通る。

## 3. 隔離リスト

- [x] 3.1 `quarantine.md` の雛形を `payload/tests/e2e/` に追加し、installer で新規作成のみ・既存は保持とする。完了条件: 再 install と `--force` で利用者の `quarantine.md` が byte 単位で変わらないことをテストで確認する。
- [x] 3.2 隔離リストの解析と検証（必須列、change 一致、期限の UTC 日付比較、当日は有効）を実装する。完了条件: 「Incomplete quarantine entry」「Same TP identifier in another change」「Expired quarantine」の fixture と、期限当日の境界ケースが通る。
- [x] 3.3 reporter で有効な隔離中の TP を coverage と欠落の両方から除外し、隔離中として表示する。完了条件: 「Valid quarantine」「Quarantined test passes」の fixture が通り、隔離中の件数が出力に出る。

## 4. final ゲート

- [x] 4.1 evidence-check に隔離の代替の検査（Oracle の pass 結果、または承認済み Residual）を追加する。完了条件: 「Alternative oracle has no passing result」「Residual is not approved」の fixture が失敗し、代替が成立している fixture が通る。

## 5. 文書

- [x] 5.1 `docs/workflow.md` と `e2e-conventions` に、フレーク方針の有効化、隔離の手順と解除、`test.skip` で隔離しない理由を追記する。完了条件: 文書の手順どおりに fixture repo で隔離と解除を再現でき、`npm run lint` が通る。
- [x] 5.2 実行をまたいだフレーク率の蓄積が対象外であることと、その Residual Risk を docs に記載する。完了条件: design の Non-Goals と記載内容が一致することをレビューで確認する。
