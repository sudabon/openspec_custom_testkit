# 移行

## 導入

```bash
npx github:sudabon/openspec_custom_testkit install --language Japanese
npx github:sudabon/openspec_custom_testkit update
npx github:sudabon/openspec_custom_testkit install --dry-run --target ../other
```

終了コードは 0 が処理の正常終了、1 が実行失敗、2 が引数不正である。0 は統合完了を意味しない。未移行が残るときは出力と `.openspec-custom-testkit.json` の `migration.status` が `incomplete` になる。完了の確認は導入先で次を実行する。

```bash
node scripts/testkit-gate.mjs doctor
```

doctor が失敗するあいだ、統合 CI の準備はできていない。

既定 schema が `spec-driven` のときだけ `quality-driven-e2e` に切り替える。`quality-driven`、`spec-driven-e2e`、その他の schema は自動変更しない。新しい change は次で作る。

```bash
openspec new change <name> --schema quality-driven-e2e
```

進行中 change の `.openspec.yaml` は書き換えない。既存の `quality-policy.md` と実在の Playwright config は `--force` でも上書きしない。旧 policy の low「任意」のままでは doctor が失敗する。kit は差分と追記例を出し、人間が policy を更新する。

## E2E 規約 lint の段階移行

kit の update で `scripts/lib/e2e-lint.mjs` を配布する。導入先の package.json は変えない（外部依存を追加しない）。既存の `quality-policy.md` は上書きしないので、強制範囲を設定する場合は人間が次の行を追記する。

```
e2e_lint_mode: enforce        # warn | enforce
e2e_lint_scope: changed       # changed | all
```

欄が無い場合は既定値（`enforce` / `changed`）で動く。doctor は欄が無いことを note として表示するが、失敗にはしない。policy の不正値・未知の `e2e_lint_*` キーと、旧 schema に適用する環境変数の不正値は `invalid-config` として失敗する。統合 schema では環境変数を引き続き無視する。

1. 導入時は `changed` で始める。統合 schema の change は、次の gate 実行からタグ付きソースと差分ファイルが強制される。既存の弱いテストは Oracle を書き直すか、人間承認済み Residual で例外にする。
2. `node scripts/testkit-gate.mjs lint --base <ref>` で警告範囲の指摘を確認し、既存テストを直す。
3. 警告が 0 件になった時点で、人間が `e2e_lint_scope: all` に上げる。以後は E2E ルート全体が強制範囲になる。

統合 schema では、`e2e_lint_mode: warn` でもタグ付きソースは強制する。`warn` が弱めるのは差分ファイルと全体範囲だけである。環境変数 `QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` は旧 `spec-driven-e2e` の change にだけ効き、統合 schema では無視したことを表示する。旧 `spec-driven-e2e` の change は既定の `warn` で指摘だけを表示する。

戻すときは kit を前の版へ update する。統合 schema の強制を policy で無効にする経路は用意していない。

## QA handoff の追加

kit の update で `templates/qa-handoff.md`、schema の Manual 層と `## 6. QA Handoff` の instruction、`scripts/lib/qa-handoff.mjs` を配布する。旧 `quality-driven` と `spec-driven-e2e` の change は変わらない。

既存の統合 change のうち、quality.md の Residual Risk に項目があるもの、または evidence の `residuals` が空でないものは、次の final 検査で `qa-handoff.md` を求められて失敗する。Manual 層も Residual も無い change は影響を受けない。対応は次のとおり。

1. quality.md の Residual Risk の各項目に `- RR1: <内容>` の形式で ID を付ける。保証外の事項が無いなら `- なし` にする。
2. `openspec/schemas/quality-driven-e2e/templates/qa-handoff.md` を change ディレクトリへ写し、自動化済み範囲・手動確認範囲・探索チャーターを埋める。`<!-- example -->` の行は残さない。
3. tasks.md に `## 6. QA Handoff` を追加する。QA 実施結果の記入はチェックボックスにせず、人間が qa-handoff.md に記入する旨の注記にする（チェックボックスにすると全タスク完了にならず、final 検査が走らない）。
4. QA 実施結果は PR の段階では空でよい（警告のみ）。archive の前に人間が実施者・実施日・判定を記入する。判定 `pass` が無いと archive の検査は失敗する。

統合 schema の Test Layer Mapping の判定も変わる。Layer 列があれば、E2E 層かどうかは Layer 列の値だけで判定し、選定理由などほかの列は見ない。以前は行のどこかに `E2E` があれば E2E 層とみなしていたので、選定理由の列にだけ `E2E` と書いていた change は、`e2e: required` なのに E2E 層が無いとして失敗しうる。その場合は Layer 列に `E2E` を書く。また Layer 列の値は `Static` / `Unit` / `Integration` / `E2E` / `Monitoring` / `Manual` に限るので、`手動` や `単体` などを書いていた change は計画ゲートで失敗する。Layer 列の値を上の名前に直す。Residual Risk の見出しが `## Residual Risk` 以外（`### Residual Risk`、`## Residual Risks`、`## Residual Risk（残存リスク）`、`## 残存リスク` など）の change と、`## Residual Risk` 見出しが無い change も失敗するので、見出しを直すか `## Residual Risk` と `- なし` を足す。Test Layer Mapping の表に見出しが `Layer` で始まる列が無い change（`層` や `Test Layer` など）と、Layer が空の行がある change も失敗するので、列の見出しを `Layer` にして各行に層を書く。

既に archive 済みの統合 change に Residual がある場合、その change を検査し直すと QA 実施結果が無いため失敗する。対象 change を検査に含める PR では、上の手順で handoff を追加する。

## 非機能観点表と Projects 列の追加

kit の update で、quality テンプレートの `## Non-functional Viewpoints` 表、test-plan テンプレートの任意の `Projects` 列、schema の instruction、`playwright.config.example.ts` の projects 例、`e2e-conventions` SKILL の `toHaveScreenshot` と `@axe-core/playwright` の規約を配布する。既存 change のテンプレートは再生成しない。

update は stamp に `features.nonfunctionalViewpoints.since`（その日の日付）を書く。既に日付がある stamp では書き換えないので、同じ内容で update を繰り返しても stamp は変わらない。stamp のほかの項目は保持する。

- 導入日より前に作られた統合 change（`.openspec.yaml` の `created` で判定）は、観点表が無くても警告だけで通る。そのまま進めてよいが、表を足せば通常の検査になる。
- 導入日以降に作る統合 change は観点表が必須になる。`e2e: required` の change は6観点すべての行を、`e2e: not-applicable` の change は6行か `| 全観点 | | UI 変更なし |` のような具体的な理由付きの1行を書く。`<理由>`・`TBD` などのプレースホルダだけでは失敗する。
- `.openspec.yaml` に `created` が無い統合 change で観点表が無いものは失敗する。`created: YYYY-MM-DD` を足すか、観点表を書く。
- 非機能観点表の必須化は、旧 `quality-driven` と `spec-driven-e2e` の change に影響しない。
- `Projects` 列が無い test-plan の project 単位の coverage 判定は変わらない（いずれかの project の pass で数える）。ただし、統合 plan の TP-ID 行検査は列の有無や change の作成日にかかわらず適用される。`TP-NNN` 形式（大文字の `TP-` と3桁の数字）でない TP-ID の行は失敗するため、既存 plan も修正が必要になる場合がある。frontmatter がある plan は schema にかかわらず reporter でも検査し、不正な TP-ID は終了コード 2 になる。frontmatter の無い旧 plan は reporter の行検査の対象外。空行やコードフェンスで表を途中で切り、後半に `TP-ID` の見出し行が無い plan、`## E2E観点一覧` に TP-ID 列の無い表（凡例やメモ）を置いた plan、閉じていないコードフェンスがある plan も失敗するので、表を1つにまとめるか見出し行と区切り行を付け、TP 以外の表は別の節に移す。`## E2E観点一覧` の後に `#` 見出しがある場合、その下の表は TP として数えなくなる。
- 統合 test-plan の `Projects` に似た列名（`Project`・`projects`・`Projects（任意）`・`Projets`・`プロジェクト`・`Playwright Projects`・`Ｐｒｏｊｅｃｔｓ` など）、重複列、空の列名は失敗する。project 指定には正確に `Projects` を使う。列名は NFKC 正規化後に記号・空白を除き、小文字にした結果に `project`・`projet`・`プロジェクト` を含むものを予約する。正確な `Projects` 以外は、`Project Owner`・`担当プロジェクト`・`Subproject`・`Projection` など独自列の意図でも拒否する。それ以外の追加列（`備考`・`Notes`・`優先度` など）は従来どおり無視し、追加列を使う既存 plan を受け入れる。
- 既存の `playwright.config.ts` は上書きしない。projects の例は `playwright.config.example.ts` として置くだけなので、必要な project を自分の設定へ写す。`@axe-core/playwright` を使うときは `npm install -D @axe-core/playwright` を実行する。

戻すときは kit を前の版へ update する。stamp の `features` は旧版では読まれない。

## 既知の旧ファイル

旧 stamp の版が QE 0.1.2 または E2E 0.2.0 で、内容が baseline に E2E root 変換を適用したバイトと一致するファイルだけを自動で置き換える。不明な版と独自編集は差分を表示して残す。必須ゲートが残ると install は 0 でも doctor は非ゼロになる。旧 stamp は読まない限り変更しない。

戻すときは、導入で上書きしたファイルを git で戻し、`.openspec-custom-testkit.json` を削除する。旧 stamp は残してあるので、旧 CLI のファイルを戻したあとに旧 kit の状態へ戻せる。policy と Playwright config は最初から上書きしていない。

## 配置先

E2E root は `--e2e-root`、新 stamp、旧 E2E stamp、静的な `testDir`、既存ディレクトリ、`tests/e2e` の順で決める。動的な config は実行しない。記録した root は、別の検出候補があっても維持する。root を変えても古いファイルは削除しない。

target の外、`..`、symlink 経由の逸脱は force と dry-run を含めて書き込み前に拒否する。

store 宣言、外部 root、global defaultStore には配置しない。成功 stamp も書かない。OpenSpec CLI が無い、または 1.13.1 未満のときはファイル準備だけを行い、ready とは報告しない。
