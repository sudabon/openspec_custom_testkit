# Tasks

## 1. 配布物のずれ検知

- [x] 1.1 `scripts/build-manifest.mjs` を `export function buildManifest(root)` と import ガード付きの CLI に分ける。`npm run manifest` を実行しても `git diff upstream/manifest.json` が空のままであることを確認する
- [x] 1.2 `openspecFork` を `critical.mjs` の `FORK_BASE` から、`stampFile` を `LEGACY_STAMPS` から取るように変える。1.1 と同じく生成結果に差分が出ないことを確認する
- [x] 1.3 `--check` モードを追加する（一致なら exit 0。不一致なら差分のあるソース id と `npm run manifest` の案内を出して exit 1）。manifest を一時的に書き換えると exit 1 になり、元に戻すと exit 0 になることを確認する
- [x] 1.4 `test/distribution.test.mjs` にテストを追加する。`buildManifest(root)` の出力が `upstream/manifest.json` と一致すること、`payload/openspec/schemas/{quality-driven,spec-driven-e2e}` の全ファイルが対応する baseline と一致すること（allowlist は空で始める）を確かめる。`node --test test/distribution.test.mjs` が通ることを確認する
- [x] 1.5 `.github/workflows/ci.yml` の lint の後に `node scripts/build-manifest.mjs --check` を追加し、`docs/upstream-sources.md` に baseline を更新するときの手順（manifest を再生成し `--check` を通す）を追記する。ローカルで同じコマンドが exit 0 になることを確認する

## 2. テスト helper の集約

- [x] 2.1 `test/support.mjs` に `writeIn(dir, rel, text)`、`tempDir(prefix)`、`GATE`（testkit-gate.mjs の絶対パス）、`runGate(cwd, args, opts)`（spawnSync のラッパー）を追加する。`gitRepo(t?)` は `t` が渡されたときに `t.after(cleanup)` を登録するようにする。既存の `npm test` が全件通ることを確認する
- [x] 2.2 `test/support.mjs` に `changeFixture(over)` を追加する。既定値は contract / gates 系の `change()` に揃え、各ファイルの既定値の違いを表にしてコメントに残す
- [x] 2.3 `contract`、`gates`、`viewpoints`、`flaky` のテストの `write`、`change` を support の helper に置き換える。ファイルごとに、置き換え前後の `node --test <file>` の pass 件数が同じであることを確認する
- [x] 2.4 `e2e-lint`、`qa-review`、`registry`、`review-regressions`、`coverage` のテストを同じように置き換える。gate の spawn は `runGate` に、`tempDir` は support のものに統一する。ファイルごとに件数が同じであることを確認する
- [x] 2.5 `install.test.mjs` の `tempDir`、`scripts/bench-coverage.mjs` の `write` を support と揃える（bench は test 外なので、`writeIn` を import するか同じ形に揃える）。`npm test` と `node scripts/bench-coverage.mjs` が動くことを確認する

## 3. 統合確認

- [x] 3.1 `npm run lint`、`npm test`、`npm run test:smoke`、`node scripts/build-manifest.mjs --check` がすべて成功することを確認する。結果を PR に記載する
