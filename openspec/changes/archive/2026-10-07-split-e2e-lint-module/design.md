# Design

## Context

- `e2e-lint.mjs` は、`// ----` の区切りで5つの層に分かれている。層の間の依存は、lexer → tokens → analyze → helpers → repo の一方向になっている。分割後は tokens と analyze の間に declarations が入る。
- 外部から使われている API は `lintRepo`（testkit-gate）、`lintChange`（evaluate）、`lintSource` / `lintChange` / `lintRepo`（テスト）である。`RULES`、`WEAK_MATCHERS`、`analyzeSource` も export されている。
- 状態は `loadState` が組み立て、`residualErrors` などの cache を途中で `??=` で足している（1152 行、1157 行）。

## Goals / Non-Goals

**Goals:**
- 1ファイルを 400 行以下にし、関数を原則 60 行以下にする。
  - ソース解析の層は定数を含めて約 530 行あり、1ファイルでは 400 行を超える。そのため宣言・import・test の別名と fixture の抽出（`declarationsOf`、`methodsOf`、`importsOf`、`testBindings`、`fixtureParameters`）を `declarations.mjs` に分け、新しいファイルは6つにする。
- 層の間の依存を一方向に保ち、下の層が上の層を import しないようにする。

**Non-Goals:**
- lint 規則の追加・変更や、検出精度の改善。
- lexer の方式の変更（たとえば外部パーサの導入）。依存を増やさない方針を保つ。

## Decisions

- **公開 API は `e2e-lint.mjs` の再 export で保つ**
  - import 元を書き換えずに済み、導入先にある古い import 経路も壊れない。
  - 代替案として「import 元を新しいパスに書き換え、`e2e-lint.mjs` を削除する」方法もある。ただしこれだと、kit を更新した導入先に古い `e2e-lint.mjs` が残ったときの扱いが必要になる。そのため削除はしない。
- **ディレクトリ名は `lib/e2e-lint/` にする**
  - ファイル名の接頭辞（`e2e-lint-lexer.mjs` など）でも分けられるが、`lib/` 直下が増えすぎるので、ディレクトリで分ける。
  - インストーラの payload 走査（`walkFiles`）はもともと再帰的なので、配置は今の仕組みのままで動く見込みである。tasks で実際に確かめる。
- **`createLintState(repo, changes, options)` は必要な cache をすべて最初に初期化して返す**
  - 状態を読む側からは、プロパティがあることを前提にできる。
- **`REQUIRED_MODULES` には `scripts/lib/e2e-lint.mjs` を残し、新しい6ファイルを追加する**
  - 欠けると実行時に import が失敗するので、doctor で検出できるようにする。

## Risks / Trade-offs

- [移動のときに、モジュール内の非公開定数や closure の参照が抜ける] → 層ごとに1 commit で移動する。毎回 `npm test` と `npm run lint` を回す。
- [`lintRepo` の closure（`statusOf`）が外側の変数を多く捕まえている] → 関数を切り出すときは、捕まえている変数を `ctx` オブジェクトとして明示的に渡す。
- [分割で import が増え、起動が遅くなる] → ESM の静的 import が5つ増える程度なので無視できる。`npm run test:smoke` の所要時間で確かめる。
