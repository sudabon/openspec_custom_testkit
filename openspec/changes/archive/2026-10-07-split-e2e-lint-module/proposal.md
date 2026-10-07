# Proposal

## Why

`payload/scripts/lib/e2e-lint.mjs` は 1353 行あり、kit で最大のモジュールである。1ファイルに次の5つの層が入っている。

| 層 | 行 |
|---|---|
| lexer | 73-295 |
| トークン列の helper | 300-411 |
| ソース解析 | 416-904 |
| helper と fixture の解決 | 912-1017 |
| repo 単位の lint | 1030-1353 |

関数も長い。`analyzeSource` は 244 行、`lex` は 223 行、`lintRepo` は 147 行ある。

このため、lint 規則を1つ足すにも、lexer から repo 単位の処理までを読む必要がある。さらに `loadState` が cache を `??=` で後から書き換えているので、状態を追いにくい。

既存のテスト（`test/e2e-lint.test.mjs`、1127 行）が厚く、それを足場にできる。この分割は最後の段階として行う。

## What Changes

- `e2e-lint.mjs` を `payload/scripts/lib/e2e-lint/` 配下のモジュールに分ける。
  - `lexer.mjs`: lexer
  - `tokens.mjs`: トークン列の helper
  - `declarations.mjs`: 宣言・import・test の別名と fixture の抽出（ソース解析の前段）
  - `analyze.mjs`: ソース解析と規則判定
  - `helpers.mjs`: helper と fixture の解決
  - `repo.mjs`: repo の走査、policy、抑止
- `e2e-lint.mjs` は、今と同じ公開 API（`RULES`、`WEAK_MATCHERS`、`analyzeSource`、`lintSource`、`lintRepo`、`lintChange`）を再 export する薄い入口として残す。import 元（`testkit-gate.mjs`、`evaluate.mjs`、テスト）は変更しない。
- 長い関数を分ける。
  - `analyzeSource` から `collectCalls`、`buildTests`、`ruleFindings`、`parseSuppressions` を切り出す。
  - `lex` は文字の種類ごとの scanner に分ける。
  - `lintRepo` から `scopeFor`、`residualStatusFor`、`placeFinding` を切り出す。
  - `testBindings` の fixture オブジェクトの解析を `fixturesOf` に切り出す。
- `loadState` を `createLintState()` に変え、状態を明示的に初期化する。
- 重複を解消する。fixed-wait のメッセージ（3回）、範囲内の expect の抽出（2回）、`start <= x < end` の判定（5回以上）が対象。
- **挙動は変えない**。検出結果、メッセージ、順序、抑止の扱いを保つ。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。`e2e-convention-lint` の要件は変わらないので `skip_specs: true` とする。

## Impact

- 対象: `payload/scripts/lib/e2e-lint.mjs` と、新しく作る `payload/scripts/lib/e2e-lint/*.mjs`。
- 配布物に `scripts/lib/e2e-lint/` ディレクトリが増える。
  - `isCritical` は `scripts/lib/` の前方一致で判定するので、新しいファイルも critical として扱われる。
  - インストーラがサブディレクトリを含めて配置できること、doctor の `REQUIRED_MODULES` にどのファイルを入れるかは、tasks で確かめる。
- 前提: `consolidate-shared-script-helpers` が archive 済みであること（`changes.mjs`、`ids.mjs`、`policy` の helper を使う）。`split-long-gate-functions` とは独立しているが、`formatLintReport` を移す作業と衝突しないように、後に着手する。
