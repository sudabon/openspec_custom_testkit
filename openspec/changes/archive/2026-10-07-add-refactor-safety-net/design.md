# Design

## Context

- 旧 schema のコピーの状況
  - `payload/openspec/schemas/quality-driven` は `upstream/baselines/qe/payload/openspec/schemas/quality-driven` と、`spec-driven-e2e` は `upstream/baselines/e2e/...` と、現時点で `diff -r` の差分がない。
  - `lib/cli.mjs` の `loadLegacyIndex` が実行時に確かめているのは、baseline と manifest の sha256 だけである。
- `scripts/build-manifest.mjs` の状況
  - 実行すると `upstream/manifest.json` を無条件に上書きする副作用がある。
  - `openspecFork: '1.13.1'` と `stampFile` を直書きしている。
- テストの状況
  - `test/support.mjs` には `gitRepo()` と `capture()` しかない。
  - 各テストファイルは `write()`、`change()`、`tempDir()`、gate の spawn をそれぞれ自前で定義している。
  - `gitRepo()` の後片付けは、`t.after` を使うもの、`finally` を使うもの、呼ばないものが混在している。

## Goals / Non-Goals

**Goals:**
- payload、baseline、manifest のずれを `npm test` で検知できるようにする。
- テスト helper の既定値を1か所にまとめ、後続のリファクタリングでテストを直す量を減らす。

**Non-Goals:**
- テストケースの追加・削除や、assert の変更（ずれ検知のテストを除く）。
- payload 側の実装の変更。

## Decisions

- **旧 schema の一致の確認は allowlist 付きの完全一致にする**
  - 旧 schema は利用者の進行中 change を元の形式のまま動かすために配布しているので、baseline と一致するのが正しい状態である。
  - 意図して差分を入れる場合は、テスト内の allowlist に理由と一緒に書く。
  - 代替案として「manifest の sha と payload を照合する」方法もある。ただしこれは manifest 自体が正しいことを前提にしてしまうので、baseline と直接比べる方を選ぶ。
- **`build-manifest` は `buildManifest(root)` を export し、CLI 部分は import ガードの中に置く**
  - こうするとテストから副作用なしで呼べる。
  - `--check` はこの関数の出力と、ファイルの JSON を文字列として比べる。
  - JSON の構造ではなく文字列で比べるのは、整形や改行の差も検知するためである。
- **`changeFixture(over)` の既定値は、6ファイルの和集合を基準にする**
  - 既定値は `contract` / `gates` 系の `change()` に揃える。
  - 他のファイルで値が違う箇所（`e2e`、`skipSpecs`、`tasksText`、`id`、`fallback` の有無）は、呼び出し側で `over` として渡し、各テストが見ている値を変えない。
- **`gitRepo(t)` の引数は省略できるようにする**
  - `t` を渡したときだけ `t.after(cleanup)` を登録する。
  - 既存の `finally { cleanup() }` は二重に呼んでも安全（`rmSync` の `force`）なので、段階的に移行できる。

## Risks / Trade-offs

- [helper を置き換えたときに、既定値の違いでテストの意味が変わる] → ファイル単位で置き換える。各ファイルの置き換え前後で `node --test <file>` の件数と結果が同じことを確かめる。
- [`--check` を CI に入れると、baseline を更新する PR で manifest の再生成を忘れて落ちる] → 落ちること自体が狙いである。失敗メッセージに `npm run manifest` を案内する。

## 後続 change の注記（この change の対象外）

分析の中で、挙動の不一致がいくつか見つかった。後続の `consolidate-shared-script-helpers` は挙動を保ったまま整理するので、これらは直さない。直す場合は、spec の差分を伴う別の change として起票する。

- TP-ID の判定
  - `markdown.tpReferences` は `TP-\d+` を使い、他の箇所は `TP-\d{3}` を使っている。
- `.openspec.yaml` を解釈する厳しさ
  - `effort` は、mapping でない値や文字列でない schema を拒否する。
  - `select` は、それらを受け入れる。
- policy の行末 `#` コメント
  - `flaky_fail_levels` だけが、行末の `#` コメントを除去しない。
- RegExp に入力をエスケープせずに渡している箇所
  - `plan-check.mjs` の `oracle.ID`
  - `frontmatter.setFrontmatterScalar` の `key`
