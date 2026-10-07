# Tasks

## 1. 準備

- [x] 1.1 インストーラが `payload/scripts/lib/` 配下のサブディレクトリを導入先に配置し、stamp に記録できるか確かめる。確かめるテストがなければ `test/install.test.mjs` に追加する。追加したテストが通ることを確認する

## 2. 層の移動（中身は変えない）

- [x] 2.1 lexer（73-295）を `e2e-lint/lexer.mjs` に、トークン列の helper（300-411）を `e2e-lint/tokens.mjs` に移し、`e2e-lint.mjs` から import する。`node --test test/e2e-lint.test.mjs` と `npm run lint` が通ることを確認する
- [x] 2.2 ソース解析（416-904）のうち宣言・import・test の別名と fixture の抽出を `e2e-lint/declarations.mjs` に、残りを `e2e-lint/analyze.mjs` に、helper と fixture の解決（912-1017）を `e2e-lint/helpers.mjs` に移す。同じテストが通ることを確認する
- [x] 2.3 repo 単位の lint（1030-1353）を `e2e-lint/repo.mjs` に移し、`e2e-lint.mjs` を公開 API の再 export だけにする。testkit-gate、evaluate、テストの import を変えずに `npm test` が通ることを確認する

## 3. 長い関数の分割

- [x] 3.1 `lex` を文字の種類ごとの scanner に分ける。e2e-lint のテスト（特に comments-strings、template、unterminated の fixture）が通ることを確認する
- [x] 3.2 `analyzeSource` から `collectCalls`、`buildTests`、`ruleFindings`、`parseSuppressions` を切り出し、`testBindings` から `fixturesOf` を切り出す。fixed-wait のメッセージ、`expectsIn`、`inRange` を共通化する。e2e-lint のテストが通ることを確認する
- [x] 3.3 `loadState` を `createLintState()` に置き換えて cache を最初に初期化し、`lintRepo` から `scopeFor`、`residualStatusFor`、`placeFinding` を切り出す。e2e-lint、gates、review-regressions のテストが通ることを確認する

## 4. 配布物と統合確認

- [x] 4.1 新しい6ファイルを `REQUIRED_MODULES`、`test/distribution.test.mjs` の必須一覧、`docs/architecture.md` に追加する。distribution と install のテストが通ることを確認する
- [x] 4.2 `npm run lint`、`npm test`、`npm run test:smoke`、`node scripts/build-manifest.mjs --check` がすべて成功し、`wc -l payload/scripts/lib/e2e-lint/*.mjs` で全ファイルが 400 行以下であることを確認する。既存の assert を変更していないことを PR に記載する
