# Tasks

本リストは kit 自体を既存の `spec-driven` で実装するためのタスクである。各実装タスクでは、対応する失敗 fixture を先に用意して RED を確認し、外から観測できる振る舞いを GREEN にする。未実行の検証はチェックしない。

## 1. 検査 fixture と契約テスト

- [x] 1.1 `test/` に E2E lint 用の隔離 fixture を作る。内容は、規則ごとの違反例・正常例と、コメント／文字列内の一致、TSX、テンプレートの入れ子、未終端ソース、helper 経由のアサーションとする。完了条件: spec の全 Scenario が fixture に対応付けられ、未実装の lint を呼ぶテストが assertion で RED になる。import 失敗だけの RED は認めない。
- [x] 1.2 タグ付きファイル、差分のみのファイル、無関係な既存ファイルを、一時 git repo の base と HEAD の差分で作る harness を用意する。完了条件: 3 種類のファイルの強制・警告の期待値がテストに書かれ、RED になる。

## 2. 字句解析と規則

- [x] 2.1 `payload/scripts/lib/e2e-lint.mjs` に、コメント・文字列・テンプレート・正規表現リテラルを区別する字句解析を実装する。完了条件: 1.1 のコメント／文字列ケースで指摘が 0 件、未終端ソースで解析不能の結果になる。
- [x] 2.2 `test` / `describe` 系の呼出し抽出（タイトル、tag、本体範囲、modifier）を実装する。完了条件: 入れ子の describe、`test.describe.configure`、オプション引数の有無の fixture で、テスト名と範囲が期待どおりになる。
- [x] 2.3 固定待機・禁止ロケーター・除外/反転・タグ欠落の規則を実装する。完了条件: 各違反 fixture が規則 ID・ファイル・行・テスト名つきで報告され、正常 fixture は 0 件になる。除外されたテストの TP は、lint 結果で実装済みとして数えない。
- [x] 2.4 アサーション欠落と存在確認だけの判定、E2E ルート配下の export helper の索引を実装する。完了条件: 操作のみ／`toBeVisible` のみのテストが失敗し、`toHaveText` を持つ Page Object helper 経由のテストと `toHaveScreenshot` のテストは通る。

## 3. 強制範囲・policy・例外

- [x] 3.1 change タグと差分による強制範囲の判定を実装し、`selectChanges` の merge-base を再利用する。完了条件: 1.2 の harness で、タグ付き／差分ファイルが失敗し、無関係な既存ファイルは警告だけになる。`--base` が無い場合は「タグ範囲のみ」と表示する。
- [x] 3.2 `quality-policy.md` に `e2e_lint_mode` / `e2e_lint_scope` 欄を追加し、読取りと既定値を実装する。完了条件: 欄の欠落・不正値は既定に戻る。統合 schema では `warn` と環境変数でもタグ付きソースが強制され、無視したことが表示される。旧 schema は既定で `warn` になる。
- [x] 3.3 抑止コメントの解析と、evidence の `residuals[]` との照合を実装する。完了条件: Residual ID なし／未知 ID は plan・final とも失敗、未承認は plan で承認待ち・final で失敗、承認済みは「承認済みの例外」として通る。効力が直後の 1 文かテスト単位に限られることを fixture で確認する。

## 4. gate・CLI・配布

- [x] 4.1 `evaluate.mjs` から required の change について lint を呼び、`cache` でファイルの解析を共有する。完了条件: 複数の change を検査しても各ファイルは 1 回だけ解析され、not-applicable の change では lint の出力が無い。既存の `check` の終了コード 0/1/2 の回帰テストが通る。
- [x] 4.2 `testkit-gate.mjs lint [--base <ref>]` サブコマンドを追加する。完了条件: 強制範囲と警告範囲に分けて表示し、終了コードが強制失敗で 1、引数誤りで 2、それ以外で 0 になる。
- [x] 4.3 install の配布物、manifest、doctor に `lib/e2e-lint.mjs` と policy の欄を追加する。完了条件: `npm pack --dry-run` に含まれ、導入先の package.json が変わらない。利用者が編集した policy は上書きされず、欄が無い場合に doctor が note を出す。

## 5. 文書と規約の同期

- [x] 5.1 `e2e-conventions/SKILL.md` に、規則 ID の対応表、抑止コメントの書式、「抑止は人間承認済み Residual が必要」を追記する。完了条件: SKILL の禁止事項と lint の規則が一対一で対応し、対応しない項目には「lint 対象外（理由）」がある。
- [x] 5.2 `docs/workflow.md` と `docs/migration.md` に、強制範囲、policy の段階移行（`changed` → `all`）、E2E Mutation を対象外とする理由を記載する。完了条件: design の Decision 3・4 と Non-Goals の記述が一致することをレビューで確認する。
- [x] 5.3 `npm test`、`npm run lint`、`npm run test:smoke` を実行し、`openspec validate add-e2e-convention-lint --strict` を通す。完了条件: すべて成功し、実行したコマンドと結果を PR に記録する。
