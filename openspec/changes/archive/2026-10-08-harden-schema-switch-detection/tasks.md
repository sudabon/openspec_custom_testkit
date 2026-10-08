# Tasks

> testkit リポジトリ（`openspec_custom_testkit`）へこの change を移動してから着手する。検証コマンドはすべて testkit リポジトリの root で実行する。

## 1. 失効した宣言を使う change の選択（D1）

- [x] 1.1 `payload/scripts/lib/schema-family.mjs` に `listCompatDeclarations(repo, { rev })` を追加する。比較元 ref の `openspec/schemas/*/testkit-compat.json` を `git ls-tree` で列挙し、有効な宣言の schema 名を返す。git の失敗は例外にし、空集合に変換しない。`test/schema-family.test.mjs` で、有効・無効・宣言なしの3種と git 失敗を確認する
- [x] 1.2 `selectChanges` で、比較元 ref があり `openspec/schemas` に差分があるときだけ失効した宣言を求める。その schema を宣言する HEAD の active change を、重複なしで選択に加える。git の失敗は終了コード 2 にする。`test/derived-schema.test.mjs` に、spec の Declaration removed without touching the change と Unused declaration is removed を追加して確認する
- [x] 1.3 派生 schema の schema.yaml から `test-plan` を消して宣言を無効にする PR でも、同じく change が加わって失敗することを確認する（Declaration invalidated through the schema file）。レビューの再現手順（PR1 で宣言だけを削除し、PR2 で実装タスクを完了にする）を git fixture にする。PR1 の時点で `check --base` が非ゼロになることを `test/cli-regressions.test.mjs` で確認する

## 2. 統合系統からの付け替えの検出（D2）

- [x] 2.1 `applyFamilies` に、比較元の系統が統合で HEAD の系統が統合以外のときの `failClosed` を、design の判定順序どおりに追加する。`test/derived-schema.test.mjs` に、Integrated change switched to an unrelated schema、Derived change switched to a legacy schema、Switch within the integrated family を追加して確認する
- [x] 2.2 archive への移動と同時に schema を付け替えた場合も失敗することと、既存の Mixed schema pull request / Unrelated schema / Legacy schema override のテストが無変更で通ることを、`test/cli-regressions.test.mjs` で確認する

## 3. lint の回帰（D3）

- [x] 3.1 `test/e2e-lint.test.mjs` に次のケースを追加する。付け替えた change と、宣言を失効させた change の2つについて、`QE_E2E_LINT_MODE=warn` / `QE_E2E_LINT_SCOPE=changed` を指定して `testkit-gate.mjs lint --base` を実行し、タグ付きソースの違反が強制（非ゼロ）のままであることを確認する（Lint cannot be weakened through a downgrade）

## 4. 文書

- [x] 4.1 `docs/workflow.md` の派生 schema の節に、次を追記する。`npm run lint` が通ることを確認する
  - 宣言の削除・無効化と、統合系統の外への schema の付け替えが失敗すること
  - 統合系統の外へ移したいときは、新しい change-id で作り直すこと
  - 比較元 ref を付けた CI の検査とブランチ保護が前提であること

## 5. 統合確認

- [x] 5.1 `npm test`、`npm run lint`、`node scripts/build-manifest.mjs --check`、`npm run test:smoke` がすべて通ることを確認する
- [x] 5.2 testkit を一時 repo に導入し、次の3経路が `check --base` で非ゼロになることを手で確認する。結果は `docs/verification-log.md` に残す
  - (a) 宣言だけを削除する PR
  - (b) `quality-driven-e2e` から `team-custom` への付け替え
  - (c) 派生 schema から `team-custom` への付け替え
