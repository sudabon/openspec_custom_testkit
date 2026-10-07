# 構成

`openspec-custom-testkit` は一つの CLI で、三つの schema を配布する。

- `quality-driven-e2e`: proposal → specs → quality → design と test-plan（互いに依存しない）→ tasks。evidence は template だけで、apply の依存ではない。
- `quality-driven`: 旧 QE。test-plan を要求しない。low の seal と反証はプロジェクトの旧 policy に従う。
- `spec-driven-e2e`: 旧 E2E。quality を要求しない。`e2e` キーが無くても required と読む。

ゲートの実装は `payload/scripts/lib/` にあり、導入先の `scripts/` へコピーされる。インストーラ本体はパッケージの `lib/` に残り、導入先には入らない。

複数のゲートが使う判定と定数は、次の共通モジュールにまとめている。新しい規則を足すときは、呼び出し側に正規表現やパスを直書きせず、ここに足す。

| モジュール | 持つもの |
|---|---|
| `critical.mjs` | schema 名、`isIntegratedChange`、`isE2eRequired`、配布の必須ファイル（`REQUIRED_MODULES`） |
| `ids.mjs` | TP-ID の正規表現（`TP_ID`、`TP_ID_IN_TEXT`、`TP_REFERENCE_LOOSE`） |
| `changes.mjs` | archive フォルダ名（`YYYY-MM-DD-<id>`）の分解、active / archive の change 一覧 |
| `change-metadata.mjs` | `.openspec.yaml` と config の schema 解釈、`quality.md` の `risk_level` |
| `policy.mjs` | `quality-policy.md` のパスと読み込み、キー行の解析、Risk Level の一覧 |
| `frontmatter.mjs` | YAML の解析、mapping と独自 tag の判定、日付 |
| `markdown.mjs` | 表と節の解析、test-plan の節見出し、表のセルと HTML のエスケープ |
| `files.mjs` / `git.mjs` | ファイル一覧と fs エラーの判定、git の呼び出し |
| `entry.mjs` | symlink を実体パスへ解決する直接実行判定（`isMain`）、エントリポイントの repo 解決、`GITHUB_OUTPUT` への追記、結果の出力 |
| `seal.mjs` | `quality.md` の読み込み、seal を止める条件（承認・QA レビュー）、QA レビュー要否の判定（`qaReviewNeeded`。不正な Risk Level は要とみなす） |

E2E 規約の lint は `e2e-lint.mjs` を入口とし、実装を `e2e-lint/` の6つのモジュールに分けている。入口は公開 API（`RULES`、`WEAK_MATCHERS`、`analyzeSource`、`lintSource`、`lintRepo`、`lintChange`、`formatLintReport`）を再 export するだけで、import 元はこのパスを使い続ける。表は最下層の lexer から順に並べており、依存は表の下の行から上の行への一方向である。上の行のモジュールは下の行のモジュールを import しない。

| モジュール | 持つもの |
|---|---|
| `e2e-lint/lexer.mjs` | 字句解析。コメント・文字列・テンプレート・正規表現・JSX をコードから分ける |
| `e2e-lint/tokens.mjs` | トークン列の helper（括弧の対応、引数、文の終わり、行番号、タグ、`inRange`） |
| `e2e-lint/declarations.mjs` | 1ファイルの宣言・import・test の別名と `base.extend` の fixture |
| `e2e-lint/analyze.mjs` | ソース解析（test / describe、expect、呼び出し）と1ファイルで決まる規則、抑止コメントの解析 |
| `e2e-lint/helpers.mjs` | ファイルをまたぐ helper と fixture の解決、アサーションの指摘、`lintSource` |
| `e2e-lint/repo.mjs` | repo の走査と状態（`createLintState`）、強制範囲、policy、抑止の承認判定 |

ゲートの中核の関数は、入力を読む関数・個々の検査をする `check*` 関数・結果をまとめる関数に分けている。`check*` は失敗や警告を戻り値で返し、呼び出し元が呼ぶ順に連結するので、出力の順序は呼び出し元を読めば分かる。`testkit-gate.mjs`、`e2e-report.mjs`、`check-test-plan.mjs` は `main` を export し、テストから `main(argv, env, io)` を呼んで終了コードを受け取れる。`ci-job.mjs` は `runCiJob(env, deps)` を export し、終了コードを含む結果オブジェクトを返す。これらの CLI は `isMain(import.meta.url)` で直接実行を判定し、symlink 経由でも起動する。

実装ごとに挙動が違う箇所は、`readChangeMetadata(..., { strict })` や `policyKeyLine(..., { stripComment })` のように、呼び出し元ごとに今の挙動を引数で固定している。

統合 digest は `manifest-sha256:` で、空集合を拒否する。旧 schema は `sha256:` と `hex  path`（空白二つ）の行を維持し、既存の空でない seal を無効にしない。

`QE_SCHEMA` は旧 schema の追加選択だけに使い、統合 change は常に対象に含める。`QE_SEAL_REQUIRED_LEVELS` は旧 schema の seal 対象だけを変え、統合 schema の全 Risk seal は外せない。
