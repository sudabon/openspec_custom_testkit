# Tasks

> testkit リポジトリ（`openspec_custom_testkit`）へこの change を移動してから着手する。検証コマンドはすべて testkit リポジトリの root で実行する。

## 1. 互換宣言の解決モジュール

- [x] 1.1 `payload/scripts/lib/schema-family.mjs` を作る。`readCompatDeclaration(repo, name, { rev })` と `resolveSchemaFamily(repo, schema, { rev })` を実装する（D1–D3）。宣言 JSON の検証（`extends` / `compatVersion` / ディレクトリ名と `name` の一致 / 予約名）を入れる。統合 schema の6 artifact の `generates` と `requires`、`apply`、evidence と qa-handoff テンプレートの構造検査は、導入先の `openspec/schemas/quality-driven-e2e/schema.yaml` を基準にする。`test/schema-family.test.mjs` で spec の Valid declaration / Derived schema drops a required artifact / Declaration reuses a reserved name / Unsupported compatibility version / Malformed declaration が通ることを確認する
- [x] 1.2 `rev` 指定時に `git show` で比較元の宣言と schema.yaml を読み、git の失敗を「宣言なし」に変換しないことを `test/schema-family.test.mjs` の git fixture で確認する
- [x] 1.3 `critical.mjs` の `REQUIRED_MODULES` に `scripts/lib/schema-family.mjs` を追加する。`scripts/build-manifest.mjs` を再実行し、`npm test` の distribution と doctor のテストで、旧 stamp に対して「必須 module が導入記録にありません」が出ることを確認する（Older install without the module）

## 2. 対象判定への組み込み

- [x] 2.1 `select.mjs` の `decorate` で `resolveSchema` のあとに系統を解決し、`schema` を系統名に、`declaredSchema` を宣言名にする（D3, D6）。`test/registry.test.mjs` か新規 `test/derived-schema.test.mjs` で `select --json` の出力に両方が出ることを確認する（Select JSON for a derived change）
- [x] 2.2 比較元と HEAD の宣言の和集合で統合扱いを決める（D4）。宣言が消えた・無効化された PR を git fixture で作り、`check --base` が統合として検査したうえで非ゼロ終了することを確認する（Declaration removed in the pull request）。宣言の無い独自 schema が従来どおり対象外になることも確認する（Custom schema without declaration）
- [x] 2.3 `QE_SCHEMA` に派生 schema 名を入れても旧 QE 扱いにならないこと（D5）と、統合・旧 QE・旧 E2E・無関係・派生 schema が混在する差分の選択結果を `test/cli-regressions.test.mjs` に追加して確認する（Environment variable cannot downgrade / Derived schema in a mixed pull request）
- [x] 2.4 テキスト出力に `schema: quality-driven-e2e (宣言: <name>)` を出す。統合と旧 schema の出力が変わらないことを `test/output-baseline.test.mjs` の既存 golden が無変更で通ることで確認する

## 3. 各ゲートでの継承

- [x] 3.1 派生 schema の change fixture（統合 schema の6 artifact と追加の `mockup-plan.md`、`## 7. Mockup` タスクグループ）を `test/fixtures/derived-schema/` に作る。未承認のまま 2.1 完了の状態で `check --phase plan` が承認欠落で失敗することを確認する（Unapproved derived change starts implementation / Extra artifact is ignored by testkit）
- [x] 3.2 `qe-gate.sh seal` を派生 schema の change に実行し、`oracle_digest` が `manifest-sha256:` になることを `test/gates.test.mjs` に追加して確認する（Seal uses the integrated digest）
- [x] 3.3 `coverage-map.mjs` と `effort.mjs` で、metadata を読んだ直後に `resolveSchemaFamily` を通す。archive 済みの派生 schema の change の test-plan が保護に数えられることと、effort 集計に含まれることを `test/coverage.test.mjs` と `test/qa-review.test.mjs`（effort 部分）で確認する。未対応 schema の警告が派生 schema に出ないことも確認する
- [x] 3.4 evidence / QA handoff / 非機能観点 / e2e-lint / flaky の各検査が、派生 schema の fixture で統合 schema と同じ失敗を出すことを、各テストファイルに1ケースずつ追加して確認する（Derived changes inherit every integrated gate）

## 4. doctor と install

- [x] 4.1 `doctor.mjs` で `openspec/schemas/*/testkit-compat.json` を列挙し、有効なものを注記に、無効なものをパスと理由付きで失敗にする。`test/install.test.mjs` か doctor のテストで確認する（Doctor lists a derived schema）
- [x] 4.2 `config-merge.mjs` で、既定 schema が有効な派生 schema のとき `schema:` を書き換えず、移行の警告も出さないようにする。派生 schema のディレクトリが install / update / `--force` で変わらないことを `test/install.test.mjs` と `test/config-merge.test.mjs` に追加して確認する（Update keeps the derived schema）

## 5. 文書

- [x] 5.1 `docs/architecture.md` の共通モジュール表に `schema-family.mjs` を追加する。`docs/workflow.md` に「派生 schema」の節を追加し、次を書く。
  - 宣言の形式と有効条件
  - fail closed の条件
  - testkit が追加 artifact を検査しないこと
  - instruction の文面は検査しないという限界（design の Risks）

  `README.md` からリンクする。`npm run lint` が通ることを確認する
- [x] 5.2 `docs/compatibility.md` に、派生 schema を前提とするアドオン向けの対応版の判定方法（`scripts/lib/schema-family.mjs` の存在）を追記する

## 6. 統合確認

- [x] 6.1 `npm test`、`npm run lint`、`npm run test:smoke`、`npm pack --dry-run` がすべて通ることを確認する。pack の内容に `payload/scripts/lib/schema-family.mjs` が含まれることも確認する
- [x] 6.2 一時 repo に testkit を install し、手で `openspec/schemas/quality-driven-e2e-mockup/` を作る。中身は統合 schema のコピーに artifact を1つ足したものと `testkit-compat.json` にする。そのうえで次を実行し、結果を `docs/verification-log.md` に残す。
  - `openspec schema validate quality-driven-e2e-mockup`
  - `openspec new change demo --schema quality-driven-e2e-mockup`
  - `node scripts/testkit-gate.mjs doctor`
  - `node scripts/testkit-gate.mjs check demo`
