# Tasks

本リストは kit 自体を `spec-driven` で実装するためのタスクである。各タスクは失敗する fixture を先に確認してから実装する。

## 1. 文書と配布物

- [x] 1.1 `payload/tests/e2e/fixtures/README.md` の列名の記述を、統合の `Fixture` と旧 `前提(fixture)` の両方に直し、「使用する TP-ID」の例を `<change-id>:TP-NNN` にする。完了条件: README と両 schema の test-plan template の列名が一致することを文書レビューと install の配布物テストで確認する。
- [x] 1.2 `payload/tests/e2e/mocks/README.md` を新設し、`## モック一覧` の表（モック名、対象サービス、契約の出典、整合の確認方法、最終確認日）と記入例を置く。完了条件: install で E2E ルート配下に配置され、既存ファイルを上書きしないことを install テストで確認する。
- [x] 1.3 統合 test-plan の instruction と template に `Fixture` 列の書式（区切り、`mock:<name>`、`なし`）を追記する。完了条件: `openspec schema validate quality-driven-e2e` が成功し、template の例が 2.x の検査に通る。
- [x] 1.4 `quality-policy.md` に `mock_contract_max_age_days: 90` の機械可読行を追加し、policy 解析で読めるようにする。完了条件: 値あり・無し（既定 90）・不正値の unit テストが通る。

## 2. plan gate の登録検査

- [x] 2.1 `Fixture` 列の要素分解と、fixtures README の表の読み取りを実装する。完了条件: 区切り文字、バッククォート、`なし`、`mock:` 接頭辞の正負例の unit テストが通る。
- [x] 2.2 fixture 名の登録と「使用する TP-ID」の `<change-id>:TP-NNN` を検査する。完了条件: spec の Unregistered fixture / Fixture row does not list the TP / Bare TP identifier / TP without preconditions の各 scenario を fixture repo で再現し、期待どおり失敗・成功する。
- [x] 2.3 README 欠落と旧 schema の扱いを実装する。完了条件: Registry file is missing が失敗し、Legacy E2E change が警告のみで終了コードが導入前と同じであることを既存の旧 schema fixture で確認する。
- [x] 2.4 mocks README の登録と必須列、日付形式を検査する。完了条件: Mock is not registered / Mock row lacks a contract source / Malformed verification date の各 scenario のテストが通る。

## 3. final gate とCI

- [x] 3.1 使用モックの鮮度を final gate で検査し、該当モック名を含む承認済み Residual を許容する。完了条件: Stale mock contract / Stale mock accepted as residual のテストが、検査日を固定した状態で通る。
- [x] 3.2 `ci-job.mjs` と reusable workflow に `contract-command` を追加し、run 記録と失敗伝達を既存 command と揃える。完了条件: 未指定時に実行も通信もしないこと、非ゼロ終了で結果保存後に job が失敗することを local harness で確認する。
- [x] 3.3 gate 出力に「fixture の冪等性は検査していない」旨を表示する。完了条件: plan gate の出力 snapshot に表示が含まれる。

## 4. 規約・レビュー観点・移行文書

- [x] 4.1 `e2e-conventions` と `docs/workflow.md` に、登録の手順、冪等性がレビュー観点であること、鮮度が検査日に依存することを書く。完了条件: 文書レビューで spec の Fixture idempotency is a review obligation を満たすことを確認する。
- [x] 4.2 Human Code Review の確認項目（policy または evidence template の review 欄の説明）に fixture の冪等性と状態非共有を加える。完了条件: medium の fixture change の review 項目に表示されることを文書レビューで確認する。
- [x] 4.3 `docs/migration.md` に既存導入先の登録追記手順と、編集済み README が保持されることを書く。完了条件: 既知未編集版の置換と編集済み版の保持を migration テストで確認する。
- [x] 4.4 `npm test`、`npm run lint`、`openspec validate add-fixture-and-mock-registry-checks --strict` を実行する。完了条件: すべて成功し、未実行の検証はチェックしない。
