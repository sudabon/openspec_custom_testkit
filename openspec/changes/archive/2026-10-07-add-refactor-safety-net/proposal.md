# Proposal

## Why

`payload/scripts/` と `lib/` には、重複実装と 200 行を超える関数が溜まっている。後続の change（`consolidate-shared-script-helpers`、`split-long-gate-functions`、`split-e2e-lint-module`）でこれらを整理する予定だが、その前に次の2点を片付けておく必要がある。

- **配布物のずれを検知できない**: 配布する旧 schema（`payload/openspec/schemas/quality-driven`、`spec-driven-e2e`）は `upstream/baselines/*` とバイト単位で同じコピーである。ところが、両者の一致も、`upstream/manifest.json` が `scripts/build-manifest.mjs` の生成結果と一致することも、どのテストでも確認していない（`scripts/lint.mjs` は `upstream` を skip している）。
- **テスト helper が重複している**: `write()` が9ファイル、`change()` が6ファイル、gate スクリプトの起動処理が5ファイルにコピーされている。このままでは、リファクタリングに合わせてテストを直すたびに同じ修正を何か所にも入れることになる。

## What Changes

- テストを追加する。配布する旧 schema のディレクトリが、採用元の baseline と内容まで一致することを確かめる。
- `scripts/build-manifest.mjs` を変更する。
  - manifest を生成する処理を純関数として export する。
  - `--check` モードを追加する。commit 済みの `upstream/manifest.json` と生成結果を比べ、差分があれば非 0 で終了する。
  - テストからも同じ比較を行う。
- `scripts/build-manifest.mjs` の `openspecFork` と `stampFile` の手書き値を、`critical.mjs` の `FORK_BASE` と `LEGACY_STAMPS` から取るように変える。
- テスト helper の重複を `test/support.mjs` に集める。
  - 集めるもの: `writeIn`、`changeFixture(over)`、`tempDir(prefix)`、`GATE` / `runGate`
  - `gitRepo(t)` は渡された `t` に cleanup を自動で登録する。
  - テストの検証内容（assert）は変えない。
- 利用者から見える CLI やゲートの挙動は変えない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。開発用の検証とテスト基盤の整理だけで、spec レベルの挙動は変わらないため `skip_specs: true` とする。

## Impact

- 対象: `scripts/build-manifest.mjs`、`test/support.mjs`、`test/distribution.test.mjs`、`test/*.test.mjs`（helper の置き換え）。CI に `node scripts/build-manifest.mjs --check` を入れる場合は `.github/workflows/ci.yml` も対象になる。
- 配布物（payload、manifest）の内容は変わらない。`--check` の結果が今の時点で差分なしになることを、着手前に確かめる。
- 後続の change はこの change を前提にする。
- 対象外: 実装コードのリファクタリング（後続の change で行う）。挙動の不一致の修正（下記の後続 change の注記を参照）。
