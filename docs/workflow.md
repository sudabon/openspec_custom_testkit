# ワークフロー

## 人間が行うこと

統合 schema では low を含むすべての Risk で、次を人間が行う。

1. risk_level が policy の `qa_review_required_levels`（初期値 `[medium, high]`）に含まれる change では、承認の前に QA レビュー担当が quality.md と specs を確認し、`qa_reviewed_by` と `qa_reviewed_at`（YYYY-MM-DD）を記入する（「QA レビュー」の節）。
2. `quality.md` の `approved_by` と `approved_at`（YYYY-MM-DD）を記入する。
3. Oracle を読んで `scripts/qe-gate.sh seal <change>` を実行する。
4. 反証の Residual を承認する。medium 以上は Human Code Review、high はドメイン担当を含める。
5. QA handoff が必要な change では、QA が手動確認範囲と探索チャーターを実施し、`qa-handoff.md` の QA 実施結果を記入する。

Agent は承認欄、QA レビュー欄、`oracle_digest`、seal を埋めない。evidence の `effort` の所要分も推測で埋めない。apply の指示は、未承認または未 seal のとき実装を止める。`scripts/qe-gate.sh seal` は本人確認をしない。CODEOWNERS とブランチ保護は PR レビューを要求する仕組みであり、seal 実行者や frontmatter の記名本人までは検証しない。

役割の入力範囲は `openspec/roles/oracle-writer.md` と `openspec/roles/falsifier.md` が正本である。Claude の adapter は `.claude/agents/` からその定義を参照する。design と実装会話は Oracle の期待値に渡さない。別セッションを起動できない環境では、同じ会話の続きで Oracle や反証を書かず、人間に別セッションの開始を依頼して止まる。

E2E 層の Oracle は test-plan の TP で観測する。同じ観測を単体テストとして再実装しない。Unit 層の Oracle に TP-ID は不要である。

## QA レビュー

QA レビューは quality.md の承認前に一度だけ行う工程である。目的は、実装前に QA のテスト設計の観点（同値分割・境界値・デシジョンテーブル・状態遷移・エラー推測・シナリオの網羅）を Failure Modes と Test Oracles に入れ、後工程の手動テストのやり直しを減らすことにある。

人間の役割は `openspec/quality-policy.md` の役割表で、quality.md 承認者・Oracle seal 実施者・QA レビュー担当・コードレビュー担当に分かれている。手順は次のとおり。

1. Agent が quality.md（と test-plan.md）を作り、承認欄・QA レビュー欄を空のまま人間に渡す。
2. QA レビュー担当が `openspec/roles/qa-reviewer.md` のチェックリストで、specs・quality.md・test-plan.md・quality-policy.md だけを読んで確認する。design.md と実装は読まない。該当しない技法は理由を書いて省略する。
3. 指摘は Failure Mode と Test Oracle の追加・修正の提案として返す。quality.md への反映は作成者と承認者が決める。QA レビュー担当は期待値を自分で確定しない。
4. 反映を確認したら、QA レビュー担当が `qa_reviewed_by` と `qa_reviewed_at` を記入する。
5. 承認者が `approved_by` と `approved_at` を記入する。反映で quality.md が変わった後に記入済みの欄があれば、承認者と QA レビュー担当が改めて記入する。
6. seal 実施者が `scripts/qe-gate.sh seal <change>` を実行する。

QA レビューを必須にする Level は policy の `qa_review_required_levels` で決まる。行が無ければ `[medium, high]`（doctor が初期値の適用を表示する）。必須の Level では次のとおり検査する。

- seal は QA レビュー欄が揃っていなければ digest を書き込まずに失敗する。
- plan / final gate は、承認欄が記入済み、タスクが一つでも完了、または final の場合に QA 欄の欠落を失敗にする。未承認・未着手の plan だけは警告に留める。
- 片方だけの記入や `YYYY-MM-DD` でない日付は、段階にかかわらず失敗にする。
- gate と seal は `qa_reviewed_at <= approved_at` を検査する。同日は許容する。日付だけのため、同日の作業順序や実際の記入時刻は確認できない。
- `qa_review_required_levels` の不正値は「不要」とみなさず、doctor と、統合 change を検査する gate・seal が失敗する。

QA レビュー欄は quality.md frontmatter にあり、`oracle_paths` 配下ではないので、欄を足しても `oracle_digest` は変わらない。必須でない Level でも、記入すれば gate は記録として表示する。QA レビューの設定は、統合 schema の全 Risk 必須の承認・seal・独立反証を外さない。旧 `quality-driven` と `spec-driven-e2e` には適用しない。kit は記入者の本人確認をせず、承認者と QA レビュー担当が別人であることも強制しない。`.github/CODEOWNERS.example` は QA チームだけを owner にし、Require review from Code Owners と併用して対象ファイルの QA 承認を要求する。複数 owner を同じ行に並べると、いずれか1人の承認で通る。これは frontmatter の記名本人や承認者と QA 担当の別人性を検証する仕組みではない。

## 人間の検証工数の記録と集計

QA の作業がレビュー担当へ移っただけなのか、全体として減ったのかを見るため、evidence の Execution Records に任意の `effort` 配列で、人間の作業時間を記録できる。各要素は `activity`（`approval` / `seal` / `qa-review` / `falsification-review` / `code-review` / `manual-test` / `other`）、`minutes`（0 以上の数値）、`recorded_by`（記入者）を持つ。`manual-test` は qa-handoff.md の手動確認範囲と探索チャーターの実施時間を記録する先である。

- `effort` の省略または空配列 `[]` ではゲートは失敗しない。`null` や配列以外の値は構造エラーになる。あるときは、未知の活動種別・負数や数値でない所要分・記入者の欠落を、要素の位置（`effort[1]` など）を示して構造エラーにする。
- 所要分は人間が記入する。Agent は推測で埋めない。

archive 済みの統合 change から集計する:

```bash
node scripts/testkit-gate.mjs effort                      # 表形式
node scripts/testkit-gate.mjs effort --since 2026-10-01   # archive フォルダの日付で絞り込む
node scripts/testkit-gate.mjs effort --format json
```

出力は活動種別ごと・risk_level ごとの合計分・記録件数・change 数、記録あり件数と平均、未記録の件数と change id、記録率、破損件数である。`effort` の省略または `[]` は「未記録」として別に数え、0 分として合算せず、平均の分母に入れない。同じ活動を1つの change に複数回記録した場合、記録件数は増えるが change 数は1件である。

記録率が 50% 未満なら、表形式と JSON の `warnings` に集計が一部しか表していないことを表示する。quality.md が無い、frontmatter が壊れている、risk_level が欠落・不正の場合、記録のある change の工数は `unknown` にまとめ、change id と理由を同じ警告に表示する。この警告だけでは非ゼロ終了にしない。

破損として報告するのは、evidence.md の欠落、Execution Records の欠落・JSON の破損・`effort` の構造エラー、`.openspec.yaml` の解釈失敗、archive フォルダ名が `YYYY-MM-DD-<id>` 形式でない場合である。既定 schema が必要な archive で config.yaml（または config.yml）を解釈できない場合も、黙って除外せず破損として報告する。change id と理由を出して終了コード 1 にする。

対象は `openspec/changes/archive/` の統合 schema の change で、metadata に schema が無い場合は config の既定 schema を使う。進行中の change と旧 schema の change は数えない。`--since` は有効な日付接頭辞で先に絞り込むので、範囲外の古い archive の破損は集計を失敗させない。日付を判定できないフォルダは範囲外とみなせないため、破損として残る。終了コードは 0（集計完了）/ 1（破損あり）/ 2（引数不正）/ 3（内部エラー）。

## 派生 schema

アドオン kit は、統合 schema `quality-driven-e2e` に artifact やタスクを足した派生 schema を配布できる。OpenSpec の schema.yaml には継承が無いので、派生 schema であることは testkit 側の宣言ファイルで示す。宣言が有効な派生 schema の change は、select・check（plan / final）・lint・seal・evidence・QA handoff・非機能観点・coverage・effort・reporter のすべてで `quality-driven-e2e` の change と同じ検査を受ける。`QE_SCHEMA` や `QE_SEAL_REQUIRED_LEVELS` で旧 schema 扱いにしたり検査を外したりはできない。

### 宣言の形式と有効条件

派生 schema のディレクトリに `openspec/schemas/<name>/testkit-compat.json` を置く。

```json
{ "extends": "quality-driven-e2e", "compatVersion": 1 }
```

宣言は次をすべて満たすときだけ有効になる。比較の基準は、導入先の `openspec/schemas/quality-driven-e2e/schema.yaml` である。

- `extends` が `quality-driven-e2e`、`compatVersion` が整数 `1`
- 同じディレクトリの `schema.yaml` の `name` がディレクトリ名と一致する
- 名前が `quality-driven-e2e`、`quality-driven`、`spec-driven-e2e`、`spec-driven` のいずれでもない
- 統合 schema の全 artifact（proposal / specs / quality / design / test-plan / tasks）を同じ `generates` で持ち、各 `requires` が統合 schema の `requires` をすべて含む
- `apply.requires` が `tasks` を含み、`apply.tracks` が `tasks.md`
- `templates/` に `evidence.md` と `qa-handoff.md` がある

宣言を読むのは project-local の `openspec/schemas/` だけである。`select --json` の要素には、判定上の `schema`（`quality-driven-e2e`）と宣言上の `declaredSchema` が並ぶ。check のテキスト出力には `schema: quality-driven-e2e (宣言: <name>)` の行が加わる。`doctor` は有効な派生 schema を注記に出す。

### fail closed の条件

宣言は検査を足す方向にしか働かない。次の場合、ゲートはその change を対象外にせず、診断を出して失敗する。

- 宣言が JSON として読めない、または上の有効条件を満たさない（doctor も失敗する）
- 比較元の宣言を git で読めない（浅い clone など）
- `--base` の比較元で有効だった宣言が、HEAD で削除または無効化されている。その schema を `.openspec.yaml` で宣言する HEAD の active change は、change 自体に差分が無くても選択に加わり、統合 change として検査されて失敗する。宣言ファイルの削除だけでなく、派生 schema の schema.yaml やテンプレート、統合 schema の変更で無効になった場合も同じである。その schema を使う active change が無ければ、宣言の削除（アドオンのアンインストール）は失敗しない
- 比較元で統合系統（`quality-driven-e2e` または有効な派生 schema）だった change の `.openspec.yaml` の `schema:` を、統合系統の外（宣言の無い独自 schema、`spec-driven`、`quality-driven`、`spec-driven-e2e`、無効な宣言の schema）へ付け替えている。archive への移動と同時の付け替えも含む。統合 schema と派生 schema の間や、派生 schema どうしの付け替えは失敗しない

上の2つで統合 change として扱う change では、lint も統合 schema と同じく `QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` を無視し、タグ付きソースを強制する。統合 change を統合系統の外へ移したいときは、schema を付け替えずに新しい change-id で作り直す。元の change は archive して最終検査を受ける。

これらの検出は、比較元 ref を付けた検査（`check --base` / `lint --base`、CI の `ci-job.mjs` は merge-base を渡す）が前提である。比較元 ref の無い検査は過去の宣言や schema を知らないので、2回の PR に分けた宣言の削除などを検出できない。PR の CI で必ず比較元 ref 付きの検査を通し、main への直接 push はブランチ保護で防ぐ。

宣言の無い独自 schema は、これまでどおり理由付きの対象外になる。testkit の update で統合 schema の artifact が増えると、古い派生 schema の宣言は無効になる。アドオンで派生 schema を再生成する。

### testkit が検査しないもの

- 派生 schema が足した artifact（例: `mockup-plan.md`）やタスクグループ（例: `## 7. Mockup`）。検査はアドオンのゲートの責務で、testkit はその存在を理由に失敗させることもない。
- artifact の `instruction` の文面。構造検査は `generates` / `requires` / `apply` / templates の有無だけを見る。派生 schema が Agent への指示を弱めても、ゲートは統合 schema と同じ基準で判定するので検査は外れない。ただし指示の妥当性は、アドオンの doctor（統合 schema との同期チェック）と人間のレビューで確かめる。

## 計画と適用

`skip_specs: true` のとき specs は skipped になり、架空の spec は作らない。quality と test-plan は proposal と変更範囲から書く。OpenSpec 1.13.1 では、skipped な specs のあと quality は ready になる。tasks まで揃うと、evidence が無くても apply は ready になる。

全タスク完了、または archive へ移した change は、CI の `gate-phase` が plan でも final として検査する。

統合 schema の seal 検査は、番号 2 以降のタスクの完了を実装開始とみなす。番号のないタスクは、それを含む見出しのうち最も近い番号付き見出し（`## N.` など）の番号で扱う。番号付きの見出しの下にないものは実装タスクとして扱う。旧 `quality-driven` は、番号 2 以降の完了だけを見る旧来の判定を維持する。

## Manual 層と QA handoff

統合 schema の quality.md の Test Layer Mapping は `Static` / `Unit` / `Integration` / `E2E` / `Monitoring` に加えて `Manual` を受け付ける。`Manual` は人が手で確認する層で、探索テストを含む。Layer 列にはこの6つの名前（大文字小文字は問わない）だけを空白・`/`・`,`・`、`・`+`・`・` で区切って書く。`手動` や `Exploratory`、綴りの誤りなど、それ以外の語があると計画ゲートが Failure Mode の ID と値を示して失敗する。`Manual` を選んだ行には Failure Mode の ID と、選定理由の欄に自動化しない理由を書く。どちらかが空なら計画ゲートが失敗する。`Manual` は E2E 層ではない。E2E 層かどうかは Layer 列だけで判定し、選定理由の欄に `E2E` と書いても E2E 層にはならない。層が `Unit` と `Manual` だけなら test-plan を `e2e: not-applicable` にしてよく、`Manual` を理由に `e2e: required` にはしない。

quality.md の Residual Risk は `## Residual Risk` 見出しの下に箇条書き（`-` / `*` / `+` または `1.` / `1)`、インデント可）で書き、各項目には `- RR1: <保証しないこと>` の形式で ID を付ける。無ければ `- なし` と書く。項目の下に一段深くインデントした箇条書きは、その項目の補足として読む。ただし `RR1:` で始まる箇条書きは、深くインデントしていても別の Residual として読む。深くインデントした箇条書きを `RR1 内容` や `**RR1**: 内容` のように `RR1:` 以外の形で書き始めると、ID が無いとして final ゲートが失敗する。`## Residual Risk` 見出しが無いとき、また `### Residual Risk`・`## Residual Risks`・`## Residual Risk（残存リスク）`・`## 残存リスク` のような近い見出しがあるときは、計画ゲートが失敗する。Test Layer Mapping の表には見出しが `Layer` で始まる列が必要で、Layer が空の行も計画ゲートで失敗する。空の箇条書きと `なし` / `該当なし` / `None` は Residual なしとみなす。

次のどれかに当てはまる統合 change では、tasks の `## 6. QA Handoff` で `qa-handoff.md` をテンプレート（`openspec/schemas/quality-driven-e2e/templates/qa-handoff.md`）から作る。

- Test Layer Mapping に `Manual` の行がある
- quality.md の Residual Risk に空でない項目がある
- evidence の `residuals` が空でない

`qa-handoff.md` は evidence と同じく apply の必須 artifact ではない。中身は次の4つの表である。

| 節 | 内容 |
|----|------|
| 自動化済み範囲 | evidence の `risk_results` のうち `result` が `pass` の Risk をすべて。Risk・Failure Mode・Oracle・Layer・Run-ID は必須で、TP-ID は E2E 層のときだけ書く。Failure Mode・Oracle・Run-ID は evidence のその Risk の値と照合する。`pass` でない Risk は載せない。QA はここを確認し直さない |
| 手動確認範囲 | Manual 層のすべての F-ID、quality.md の `RR*`、evidence の `residuals[].id`。種別は `Manual` か `Residual` |
| 探索チャーター | 1行以上。Charter-ID・目的・対象・時間の目安 |
| QA 実施結果 | 実施者・実施日・判定（`pass` / `fail`）・所見。人間だけが記入する |

final gate は、必要な change で次の場合に失敗する。`qa-handoff.md` が無い、節が無い、Manual 層の F-ID または Residual の ID が手動確認範囲に無い、quality.md の Residual に ID が無い、自動化済み範囲が `pass` の risk_results と一致しない（Failure Mode・Oracle・Run-ID の照合を含む）、探索チャーターや表の必須欄が空、手動確認範囲の種別が `Manual` / `Residual` 以外、探索チャーターが0行、表の ID が重複している、`<!-- example -->` の付いた記入例の行が残っている。evidence の Execution Records を読めないときは、自動化済み範囲の照合を省いて警告を1件出す（evidence の不備そのものは evidence の検査が失敗にする）。どの条件にも当てはまらない change では handoff を要求しない。

QA 実施結果欄は人間だけが記入する。Agent は記入しない（schema の instruction、tasks、role 定義で禁止している）。QA の実施は tasks.md のチェックボックスにしない。全タスク完了で final 検査が走るので、QA をタスクにすると QA が終わるまで PR の CI で handoff の検査が走らないためである。PR の final 検査（全タスク完了時の CI を含む）では、この欄が空でも、値が不正でも警告に留める（不正な欄を示す）。QA を待つために PR を止めたり、Agent に空欄を埋めさせたりしないためである。表に複数の行があるときは、最後に記入された行を現在の結果として読む。QA をやり直したら前の行の下に追記する。archive された change では、実施者、`YYYY-MM-DD` 形式の実施日、`pass` または `fail` の判定が揃っていなければ、不足または不正な欄を示して失敗する。判定が `fail` のときも失敗するので、所見を修正するか、Residual として人間が承認し直してから archive する。

kit は QA 実施結果の記入者の本人確認をしない。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存する。

Residual を書くと handoff が必要になる。小さな change で QA に渡すものが無いなら、Residual を書かない（`- なし`）のが正しい運用である。

旧 `quality-driven` と `spec-driven-e2e` の change には、Manual 層の理由も qa-handoff.md も要求しない。

## 非機能観点（Non-functional Viewpoints）

統合 schema の quality.md は `## Non-functional Viewpoints` 表を持つ。列は `観点` / `Failure Mode` / `該当なし理由` で、観点は次の6つに固定する（テンプレートの表記のまま書く。`/` と `／`、空白の違いは同じ観点として読む）。

- クロスブラウザ／デバイス／レスポンシブ
- 見た目の回帰
- アクセシビリティ
- 文言・多言語
- 性能
- 入力系セキュリティ

各行には、割り当てた Failure Mode の ID（`F1, F2` のように `,`・`、`・空白区切りで複数可）か、該当なし理由のどちらか一方だけを書く。計画ゲートは次の場合に失敗する。

- 観点の行が欠けている、知らない観点名がある、同じ観点が重複している
- Failure Mode に、同じ quality.md の Failure Modes に無い ID がある（例: 性能行が存在しない `F9` を参照）
- Failure Mode も理由も空、または Failure Mode 欄が `該当なし` だけで理由が空（`該当なし()` のように中身の無い理由も空とみなす）
- Failure Mode が無く、理由が `<理由>`・`-`・`–`・`—`・`TBD`・`TODO`・`未定`・`なし`・`N/A`・`NA`・`...`・`…` だけである（英字の大小は問わない）。`該当なし（理由）` の括弧内も同じ規則で検査する。これらは空として扱うため、Failure Mode が指定されていれば理由との二重記入にはならない
- Failure Mode と理由の両方が書かれている

計画検査の対象となる統合 change で `quality.md` 自体が無い場合も失敗する。コードフェンス内の `## Non-functional Viewpoints` 表（テンプレートの例の貼り付けなど）は観点表として読まず、quality.md に閉じていないコードフェンスがある場合も失敗する。`check-test-plan.mjs` は観点表の移行警告を `::warning::` として出力する。その他の評価・lint の警告は従来どおり `testkit-gate.mjs check` で確認する。

割り当てた Failure Mode は、Test Layer Mapping で E2E などの層に割り当てる。ゲートが確認するのは ID が Failure Modes にあることまでで、割り当てた層が観点に合っているかは見ない。自動化できない観点（主観的な見た目の評価など）は、その Failure Mode を `Manual` 層にし、QA handoff の手動確認範囲に載せる。

### UI に触れる change の判定と限界

統合 schema は「UI に触れる change か」を test-plan の `e2e` で代用する。`e2e: required` の change は利用者から見える振る舞いを持つとみなし、6観点すべての行を要求する。`e2e: not-applicable` の change は、6行を書くか、観点を `全観点` とした1行（`| 全観点 | | UI 変更なし |`）で済ませてよい。`全観点` の行には理由だけを書き、ほかの観点の行と併用しない。`e2e: required` の change で `全観点` の1行にすると失敗する。

この代用には限界がある。UI に触れるのに `e2e: not-applicable` とした誤りは、観点表の検査では見つからない。quality の層選択と test-plan の整合検査（E2E 層があるのに not-applicable なら失敗）と、人間による quality 承認で見つける。観点ごとの「該当なし」が妥当かもゲートは判定しない。理由は必須なので、quality の承認者が理由を読んで判断する。

### 導入前の change

kit の install / update は、観点表を初めて配置したときに stamp（`.openspec-custom-testkit.json`）の `features.nonfunctionalViewpoints.since` に日付（YYYY-MM-DD）を書き、以後の update では書き換えない。観点表の無い統合 change は次のように扱う。

| 状態 | 結果 |
|------|------|
| `.openspec.yaml` の `created` が導入日より前 | 警告のみ（進行中の change を update だけで壊さない） |
| `created` が導入日以降 | 失敗 |
| `created` が無い、または YYYY-MM-DD として読めない | 失敗（導入前と確認できないため対象外にしない） |
| stamp に導入日が無い・不正、または metadata / stamp が破損している | 失敗（欠落・破損・不正な日付を区別して報告） |

表がある change は、作成日にかかわらず上の規則で検査する。旧 `quality-driven` と `spec-driven-e2e` の change には観点表を要求しない。

### Projects 列（project 単位の実行照合）

test-plan の `## E2E観点一覧` には任意の `Projects` 列を置ける。値は Playwright project 名を `,` または `、` で区切る（例: `chromium, mobile-safari`）。同梱の `playwright.config.example.ts` は、既定の npm setup に合わせて `chromium` だけを有効にする。`webkit` / `mobile-safari` はコメント内の追加例であり、使う場合は caller setup で WebKit も導入する。統合 plan の見出しは `TP-ID` / `Requirement` / `Scenario` / `Risk` / `Oracle` / `Fixture` / `Intent` / `Expected` / `Projects` を使う。`Projects` に似た列名（`Project`・`projects`・`Projects（任意）`・`Projets`・`プロジェクト`・`Playwright Projects`・`Ｐｒｏｊｅｃｔｓ` など）、重複列、空の列名は計画ゲートで失敗する。列名は NFKC 正規化後に記号・空白を除き、小文字にした結果に `project`・`projet`・`プロジェクト` を含むものを予約する。正確な `Projects` 以外は、`Project Owner`・`担当プロジェクト`・`Subproject`・`Projection` など独自列の意図でも拒否する。それ以外の追加列（`備考`・`Notes`・`優先度` など）は無視する。reporter は schema ではなく frontmatter の有無で形式を判定し、frontmatter がある plan では同じ見出し検査を行い、違反は入力エラー（終了コード 2）になる。旧 `spec-driven-e2e` の表も追加列として受け入れるが、`e2e:` frontmatter を付けると見出し検査の対象になる。frontmatter が無い旧 plan は従来どおり検査しない。表は小見出しで分けられ、列名は表ごとに解釈する。区切り行は各セル1個以上の `-` と任意の整列指定 `:` を受け付け、コードフェンス内の表の例は検査・coverage の対象外にする。表を分けるときは見出し行と区切り行を付ける。区切り行は見出し行の次の行だけで、それより後の `| - | - |` のような行は TP 行として検査する。空行やコードフェンスで切れた`TP-ID` の見出し行で始まらない表の断片、TP-ID 列の無い表（凡例やメモの表）、閉じていないコードフェンスは、行を黙って除外せず計画ゲートで失敗し、frontmatter がある plan は reporter でも入力エラー（終了コード 2）になる。TP 以外の表は別の節に置く。`#` / `##` の見出しに加え、`E2E観点一覧` または `対象外` で始まる見出しは階層にかかわらず節を区切る。TP を読むのは `## E2E観点一覧` の節だけとする。それ以外の節（`## 補足`・`# Appendix`・`## 対象外シナリオ` の下の小見出しなど）や最初の見出しより前に TP-ID 列の表がある plan、および `## 対象外シナリオ` 以外の `E2E観点一覧` / `対象外` で始まる見出し（`### E2E観点一覧の補足`・`### 対象外ブラウザ` など）の下で TP-ID を参照する plan は、計画ゲートで失敗させ、frontmatter がある plan は reporter でも入力エラー（終了コード 2）にする。TP-ID の参照は coverage と同じく、前後が英数字・`.`・`/`・`_`・`-` でない大文字の `TP-数字` だけを数える（`HTTP-2` や `tests/e2e/TP-001.spec.ts` は参照ではない）。計画ゲート・reporter・coverage は同じ節の同じ表から TP を読む。統合 plan の TP-ID は大文字の `TP-` と3桁の数字を必須とし、不正な行を黙って除外しない。reporter も frontmatter がある plan で同じ TP-ID 検査を行い、不正な TP-ID または `not-applicable` に TP 行がある場合は入力エラー（終了コード 2）にする。

- 値がある TP は、書いた全 project で、`@<change-id>` と `@TP-NNN` を持つテストに実 attempt の pass（expected または flaky）がある場合だけ coverage に数える。
- 対象 change・TP に対応する結果行が無い、またはすべての行で attempt 記録が0件の project は未実行として欠落になり、reporter は `TP-002 (mobile-safari 未実行)` のように TP と project を表示して終了コード 1 を返す。skip でも attempt 記録が0件なら `未実行`、1件以上あって pass が無ければ `未pass` と表示する。実 attempt がある結果行もすべて skip なら、skip 条件を確認するヒントを表示する。
- いずれかの project で fail があれば、欠落より失敗を優先して終了コード 3 を返す。終了コードの意味（0/1/2/3）は変わらない。
- 列が無い、または値が空の TP は従来どおり、いずれかの project の pass で数える。列の無い既存 plan の project 単位の coverage 判定は変わらない。見出し・TP-ID の入力検査は別途適用する。
- 空の要素（`chromium, , chromium`）は計画ゲートが失敗し、reporter 単体では入力エラーになる。重複は1つにまとめる。project 名が Playwright 設定に存在するかは検査しない（動的な設定を実行しないため）。設定に無い名前を書くと、reporter が未実行として欠落を報告し、`Projects` の指定と Playwright の project 名・実行対象・skip 条件の確認を促す。

project を増やすと CI の時間も増える。クロスブラウザや端末差の確認が必要な TP だけに `Projects` を付ける。見た目の回帰（`toHaveScreenshot`）とアクセシビリティ（`@axe-core/playwright`）のテストの書き方は `e2e-conventions` SKILL にある。kit は導入先の `package.json` に依存を追加しない。

## E2E 結果の公開

CI の E2E 結果は、PR の Checks 画面から辿れる形で公開する。公開は表示のための処理で、ゲートの判定には使わない。

### summary の読み方

`e2e-report.mjs <change-id> [results.json] --format summary` は、人向けの Markdown 要約を出す。`--format` を省略した出力（`text`）と終了コード 0/1/2/3 は従来と同じで、`summary` も同じ分類から描画するため終了コードは一致する。`text` と `summary` 以外の値は終了コード 2 になる。出力例（行と添付の一部を省略）:

```text
### demo

実行開始: 2026-10-06T00:00:00.000Z (10分前) / 所要 12.3s
合計 5 件: pass 3 / fail 1 / skip 1 / フレーク 1
⚠ カバレッジ欠落: TP-002, TP-004, TP-005 に対応するテストが未実装/未実行

| TP-ID | テスト | project | 結果 | フレーク | 添付 |
|-------|--------|---------|------|----------|------|
| TP-002 | 保存に失敗する | chromium | fail |  | screenshot: <code>test-results/save-chromium/test-failed-1.png</code><br>trace: <code>test-results/save-chromium/trace.zip</code><br>video: 公開対象外 |
```

- 表の前に、実行開始時刻、所要時間、件数、カバレッジ欠落の TP-ID を置く。欠落が無いときは「カバレッジ欠落: なし」と出る。
- project 列は、単一 project でも Playwright JSON の project 名を出す。test-plan の `Projects` 列との照合結果は欠落の行に出る。
- 添付列は、失敗した attempt と最後の attempt の添付（trace / screenshot / video と `testInfo.attach` の添付）を、公開 root からの相対パスで示す。公開 root は CI では実行ごとの directory（`test-results/testkit/<run>/`）、CLI では results.json の directory である。
  - 公開 root の外にある添付は「公開対象外」と示し、パスは出さない。
  - 公開 root の内側を指すがファイルが無い添付は、相対パスに「（ファイルなし）」を付ける。
  - `body` で埋め込まれた添付は名前だけを示し、中身は出さない。
  - 添付が1つも無い行は「添付なし」と示す。
- テスト名などの表のセルは、`|`、改行、HTML の記号をエスケープする。

### CI での公開

reusable workflow の gate は、E2E required の change ごとに次を行う。

- 実行 directory に `<change-id>.summary.md`（全行）を書き、step summary に追記する。step summary は change あたり 200 行までで、超えた分は artifact 内の `<change-id>.summary.md` を参照する行になる。step summary 全体の累積上限 900 KiB を超える change は、要約の代わりに参照の行だけを出す。
- E2E を実行しなかったときは、表を出さずに理由（e2e-command が空、E2E required の change が無いなど）だけを出す。git リポジトリの特定、change 選択、report-max-age、lockfile などの入力・セットアップ確認で早期終了した場合も、終了理由を step summary と PR コメント用の要約に残す。
- artifact `testkit-playwright-report` に今回の実行 directory（HTML レポート、添付、results.json、要約）を保存する。前回の実行の directory は含めない。既存の `testkit-results` も従来どおり保存する。
- step summary の末尾に、ワークフロー実行と artifact へのリンクを追記する。`testkit-results` のアップロード失敗や成果物が無い場合も「保存されていません」と表示し、同じ案内を PR コメントに含める。

公開系の step は、ゲートやテストが失敗しても実行し、`continue-on-error` で job の結果を変えない。要約生成の例外や step summary・GITHUB_OUTPUT の書き込み失敗は警告として出る。artifact を保存できない場合は公開先の案内に記載し、PR コメントの投稿失敗は警告として出る。レポートを作れない場合は job ログを案内する。job の成否は、公開の成否に関係なくゲートの結果で決まる。

添付は Playwright の `outputDir` を `TESTKIT_RUN_DIR` 配下に、HTML reporter の `outputFolder` は `TESTKIT_RUN_DIR/playwright-report` に設定する。同梱の `playwright.config.example.ts` がその設定例である。公開前に `playwright-report/index.html` の存在を確認し、無い場合は警告を出して artifact を「今回の結果」と案内する。独自 config で別の場所に出した添付は「公開対象外」と表示する。いずれもゲートの判定には影響しない。

`regression-command` の `TESTKIT_RUN_DIR` は、E2E の実行 directory 内の `regression/` を指す。これにより回帰実行時の出力初期化が E2E の HTML レポートや添付を消さない。`TESTKIT_RESULTS_JSON` は従来どおり実行 directory 直下の `regression-results.json` を指す。

### PR コメント、権限、保持期間

PR コメントは入力 `publish-pr-comment: true` のときだけ投稿する。既定は投稿しない。マーカー `<!-- openspec-custom-testkit -->` の付いた github-actions のコメントを 1 件だけ作り、以後の実行では同じコメントを更新する。投稿には呼び出し側 workflow の `pull-requests: write` 権限が必要で、reusable workflow は権限を引き上げない。fork からの PR など書き込み権限が無い場合は警告だけを出す。

artifact の保持日数は入力 `artifact-retention-days` で指定する。空なら GitHub の既定に従う。正の整数以外（`0`、負数、文字列など）はゲートの前に入力エラーで止まり、ゲートを成功と報告しない。

### 添付の機微情報

screenshot、video、trace には、画面に表示された個人情報、トークン、内部 URL が写ることがある。private リポジトリでも、artifact はリポジトリを閲覧できる全員がダウンロードできる。kit は添付や HTML レポートの中身を検査も、マスキングもしない。テストデータには合成データを使い、保持日数は必要な期間に絞る。

## フレーク方針と隔離

統合 schema `quality-driven-e2e` の change だけが対象である。旧 `spec-driven-e2e` の change には、フレーク方針も隔離リストも適用しない（隔離リストに旧 schema の change の行があると、reporter は警告だけを出す）。

### フレーク方針の有効化

既定では、Playwright のリトライ後に成功した flaky のテストを pass として coverage に数え、フレーク列に ⚠ を出す。終了コードは変わらない。

Risk に応じて不合格にするには、人間が `openspec/quality-policy.md` に次の設定を独立した行として追記する。インデント・箇条書き記号・バッククォートを付けず、キーとコロンの間も空けない。kit はこのファイルを上書きしないので、追記は手で行う。

```
flaky_fail_levels: [high]
```

- 値は `low` / `medium` / `high` を角括弧で列挙する（例: `[medium, high]`）。`[]` は方針なしと同じである。
- reporter は TP の Level を、test-plan の `Risk` 列から quality.md の Risk Register の `Level` を引いて決める。複数の TP を持つテストは最も高い Level で判定する。
- 列挙した Level の TP が flaky になると、結果列は `pass` のまま、フレーク列に `⚠ 不合格（high）` を出し、終了コード 3（失敗テストあり）にする。
- 列挙していない Level の flaky は `⚠ 警告（low）` と表示し、coverage に数える。
- Level を解決できない TP（quality.md が無い、Risk が未登録、Level が不正）の flaky は、理由を表示して不合格にする。
- 上記以外の値・角括弧の無い値・複数の行・設定らしい行の書式違い（インデント、箇条書き、バッククォート、コロン前の空白、単数形のキーなど）は、doctor の失敗、reporter の入力エラー（終了コード 2）になる。黙って無視すると、方針を書いたつもりで効いていない状態になるからである。
- 戻すときは行を消す。

導入直後は CI が頻繁に落ちることがある。`[high]` から始め、壊れたテストは次の隔離リストで期限付きで外す。

### 隔離の手順

1. E2E ルート直下の `quarantine.md`（install が雛形を作る。既存のファイルは `--force` でも上書きしない）に行を足す。

   ```
   | TP-ID | Change | 理由 | 担当 | 期限 | 代替 |
   |-------|--------|------|------|------|------|
   | TP-002 | add-checkout | 決済モックの起動待ちが不安定 | qa-team | 2026-10-31 | O3 |
   ```

   - `Change` は必須である。同じ TP-ID でも change ごとに別物なので、別の change の行は効かない。Change が空の行は警告して無視し、coverage や他の行の重複判定に影響させない。
   - `期限` は YYYY-MM-DD で、UTC の日付で比べる。期限日の当日までは有効、翌日から期限切れになる。
   - `代替` は、その change の quality.md の Test Oracles にある Oracle ID（E2E 以外の層で同じ壊れ方を確かめるもの）か、evidence.md の `residuals[]` の ID である。
2. テストのソースはそのまま残し、実行から外す。CI の e2e-command（またはローカルの実行）に、change と TP の両方のタグを持つテストだけを除く `--grep-invert` を足す。

   ```
   npx playwright test --grep-invert '(?=.*@add-checkout(?=\s|$))(?=.*@TP-002(?=\s|$))'
   ```

   タグの末尾を空白または行末で区切るため、`@add-checkout-v2` や `@TP-002-extra` は除外しない。`@TP-002` だけで除くと、同じ TP-ID を持つ別の change のテストまで外れる。
3. final までに代替を evidence.md に記録する。Oracle なら `risk_results` に、その Oracle を含み、`layer` が E2E 以外で `result: "pass"` の行が要る。Residual なら `residuals[]` の該当項目に `approved_by` と `approved_at` が要る。無ければ final ゲートが TP-ID と代替を示して失敗する。

reporter は有効な隔離中の TP を coverage にも欠落にも数えず、`隔離中: N 件` と各行の担当・期限・代替・理由を毎回表示する。隔離中のテストが実行されて pass しても coverage には数えない。実行されて fail した場合は失敗（終了コード 3）のままである。対象 change の行で理由・担当・期限・代替のどれかが空の行、期限の書式が不正な行、quality.md に無い Oracle を代替にした行、同じ TP の重複行、期限切れの行は隔離として扱わず、理由を付けて欠落（終了コード 1）にする。final ゲートでも対象 change の無効な行を再検査し、TP-ID・担当・期限と理由を表示して失敗する。レポート実行後に期限が切れた場合も同じである。

### 解除の手順

1. テストを直し、手順 2 で足した `--grep-invert` を外す。
2. `quarantine.md` から行を消す。
3. reporter が、その TP を通常どおり coverage として数えることを確かめる。

隔離中の TP が pass しても kit は自動で解除しない。解除は人間がリストの行を消して行う。

### `test.skip` で隔離しない理由

`test.skip` / `test.fixme` は e2e-conventions が禁止している「skip の追加」と区別できず、lint（`excluded-test`）も除外として指摘する。テストソースに書くと、隔離の期限・担当・代替がレビューの差分から見えない。隔離は `quarantine.md` の 1 ファイルに集約し、期限切れと代替の欠落をゲートで止める。

### 対象外と Residual Risk

- 判定は 1 回の実行の結果だけで行う。実行をまたいだフレーク率は蓄積しない。履歴を CI の artifact、リポジトリへの commit、外部ストアのどこに置くかで権限と改ざん耐性の要件が変わるため、後続の change で扱う。
- Residual Risk: たまにしか出ないフレークは、その実行でリトライが起きなければ検出できない。1 回の Green は「その実行で flaky が出なかった」ことしか示さない。
- フレークの検出に基づく自動隔離と自動解除は行わない。人間の判断を経ずに coverage を外すことになるからである。
- 同梱の `playwright.config.example.ts` の `retries` の既定値は変えない。利用者の Playwright 設定は保護ファイルである。
- シナリオ対応表（`coverage-map`）は隔離リストをまだ読まない。隔離中の TP を「保護なし（隔離中）」として扱うのは別 change である。

## fixture とモックの登録

統合 schema の `e2e: required` の change では、計画ゲートが test-plan の `Fixture` 列を検査する。目的は、E2E が Green のときに前提データやモックの妥当性を QA が手作業で確かめ直さなくて済むよう、その根拠を登録表に残すことである。

### 登録の手順

1. test-plan の `Fixture` 列に前提状態を `,` または `、` で区切って書く。`mock:<name>` は外部サービスのモック、それ以外は fixture 名。前提状態が無い TP は `なし` とだけ書く。空欄は失敗する。
2. fixture 名は E2E ルートの `fixtures/README.md` の `## fixture 名 → 作られる状態` に行を置き、「使用する TP-ID」に `<change-id>:TP-NNN` を書く。TP-ID は change ごとに採番されるため、`TP-002` だけの記載は数えない。
3. モックは E2E ルートの `mocks/README.md` の `## モック一覧` に、モック名・対象サービス・契約の出典・整合の確認方法・最終確認日（YYYY-MM-DD）をそろえて登録する。将来の日付は失敗する。モックの表には TP-ID 列を置かない（使用箇所は test-plan から逆引きできる）。
4. README が無いのに fixture 名・モックを参照すると、README のパスを示して失敗する。

旧 `spec-driven-e2e` の change（列名 `前提(fixture)`）は同じ不整合を警告だけにし、終了コードを変えない。旧 `quality-driven` と `e2e: not-applicable` の change は対象外である。

### モック契約の鮮度

最終検証ゲートは、使用モックの最終確認日から**検査を実行した日**（UTC）までの日数が `quality-policy.md` の `mock_contract_max_age_days`（既定 90）以下であることを検査する。鮮度は検査日に依存するので、同じコミットでも日をまたぐと結果が変わる。これは意図した挙動で、古い照合結果のまま archive しないためである。超過したモックは、実物と照合し直して最終確認日を更新するか、モック名を含む人間承認済み（`approved_by` と `approved_at`）の Residual を evidence の `residuals` に書く。

最終確認日は人間が照合内容を確かめて更新する欄で、Agent は書き換えない。CI の任意入力 `contract-command` は契約テストを実行して run 記録に残すが、成功しても最終確認日は更新しない。`contract-command` が空なら、kit は外部サービスへ何も送らない。

### 冪等性はレビュー観点

kit は fixture の冪等性とテスト間の状態非共有を機械的に検査しない。実装方式（シード API・DB 直接）ごとに確かめ方が違い、静的検査では誤検知が多いためである。計画ゲートは「fixture の冪等性・テスト間の状態非共有は検査していません」と表示し、gate の成功を冪等性の保証として扱わない。medium 以上の Human Code Review では、fixture を追加・変更した change について次を確認する（policy の §5 と evidence テンプレートの review 欄の説明に同じ項目がある）。

- fixture が各テストの前に状態をべき等に作り直すこと
- テスト間で状態を共有しないこと（実行順の入れ替えや単独実行で結果が変わらない）

## E2E 規約 lint

e2e 適用状態が required の change（旧 `spec-driven-e2e` を含む）では、`testkit-gate.mjs check` が E2E ルート配下の `.js` / `.ts` 系ソースを静的に検査する。規則は固定待機（`fixed-wait`）、禁止ロケーター（`forbidden-locator`）、実行の除外・反転（`excluded-test`）、タグ欠落（`missing-tag`）、アサーション欠落（`missing-assertion`）、存在確認だけのアサーション（`weak-assertion`）である。規約との対応表は `.claude/skills/e2e-conventions/SKILL.md` にある。`.feature` は手続きを持たないので対象外とし、`lint` の一覧に「対象外」と表示する。

E2E required の change が検査対象にある場合、強制範囲は「検査対象 change のタグを持つテストソース」と「比較元から HEAD までの差分で変更された E2E ソース」の和である。前者は新しい TP の弱さを、後者はタグの無い既存ファイルからアサーションを消す後退を止める。手を付けていない既存ファイルの指摘は警告に留め、導入先が一斉に失敗しないようにする。差分は `selectChanges` が解決した merge-base から取る。`--base` が無いローカル実行では差分による強制は行わない。`scope: all` なら全ソースを、それ以外はタグ範囲だけを強制し、その旨を表示する。未コミットの変更は HEAD との差分に含めない。CI では reusable workflow の `base-ref` を必ず渡す。E2E required の change が無い PR では `check` / CI の lint は起動しない。既存 E2E の後退をゲートで止める場合も、対応する required change を含める。

強制範囲内で読めない、または字句解析できないソースは失敗にする。指摘なしとしては扱わない。

フレークの隔離は lint の例外ではない。隔離を理由にした `test.skip` / `test.fixme` も lint は除外の指摘として残す。fixture と mock の登録検査はこの lint では扱わず、計画ゲートが行う（「fixture とモックの登録」）。`fixed-wait` は別名に代入した `setTimeout` を追跡しない。`missing-tag` は active / archive の change ID と照合し、`@smoke` などの一般タグだけでは通さない。

`node scripts/testkit-gate.mjs lint [--phase plan|final] [--base <ref>] [<change>...]` は E2E ルート全体の指摘を強制範囲と警告範囲に分けて表示する。`--phase` の既定値は `plan`。検査ファイル数も表示する。終了コードは強制範囲の失敗、不正な抑止・設定、入力の読み取り失敗、検査ソース 0 件、change 選択・適用状態の判定失敗があれば 1、引数の誤りは 2、それ以外は 0 である。test-plan 未作成の計画途中の change は、適用状態の判定失敗に含めない。対象 change が 0 件でもソースを検査できれば警告一覧を表示する。`check` の終了コードの意味は変わらない。

欄が無い場合は既定値（`enforce` / `changed`）で動く。doctor は欄が無いことを note として表示するが、失敗にはしない。policy の不正値・未知の `e2e_lint_*` キーと、旧 schema に適用する環境変数の不正値は `invalid-config` として失敗する。統合 schema では環境変数を引き続き無視する。対象 change が無い lint でも、不正な環境変数は診断して失敗する。

### 例外の承認

XPath の引数検査では、`page` / `p2` / `popup` / `frame`、末尾が `Page` / `Frame` の名前、`frame()` / `*Frame()` の戻り値を Page / Frame の受け手として扱う。型解析は行わないため、それ以外の名前では `fill()` 等の値引数を XPath と判定しない。Locator に存在しない `waitForSelector()` / `dragAndDrop()` は、受け手によらず第 1 引数をセレクタとして検査する。XPath とみなすのは Playwright の自動判定と同じく `//` / `..` で始まる文字列と `xpath=` で、`./` は XPath として扱わない。`locator()` 等の禁止メソッドの検出は受け手によらない。

規則の例外は、理由と evidence の Residual ID を書いた抑止コメント `// e2e-lint-allow <rule-id> <residual-id>: <理由>` でだけ書ける。抑止コメントは独立した行に置く。文の行末への配置、ブロックコメントと同じ行へのコード配置、describe 全体の抑止は無効とする。効力は直後の 1 文、またはテスト宣言の直前に置いた場合はそのテスト全体に限る。参照先は change の `evidence.md` の Execution Records にある `residuals[]` で、反例の Residual と同じく `reason`、`impact`、`approved_by`、`approved_at` を検査する。

参照先は、選択された change と、抑止対象テストの実際の change タグに対応する change（archive を含む）の和集合とする。

テスト内の抑止では、そのテストと囲んでいる describe のタグを使い、別テストのタグは参照先を増やさない。フック等のテスト外の抑止では、囲んでいる describe の change タグを使い、それが無い場合は同じファイル内のテスト・describe のタグを使う。コメント・一般文字列は参照先を増やさない。全履歴を候補にするのはテスト・describe の宣言が無い helper 専用ファイルに限り、archive の過去の承認の再利用を認める。選択されていない change の evidence に Execution Records が無い場合は Residual なしと扱うが、JSON の破損や読み取り失敗はエラーとする。

同じ ID が選択中の evidence にあればその記録を優先し、過去の承認で未承認状態を上書きしない。優先後の候補に同じ ID が複数残れば、不正な抑止として失敗し、一意な ID への変更を求める。この候補外の change から承認を流用してはならない。

Residual ID は候補となる change 間で衝突しないよう、`RES-demo-001` のように change 名を含めて採番することを推奨する。`RES-1` のような ID を再利用すると、選択中の同名記録が過去の抑止にも優先され、承認を取り消したり意図せず承認したりする。archive 間の同名 ID も helper の参照を曖昧にするため、既存 ID を変更するときは evidence と抑止コメントを一緒に更新する。`old/RES-1` のような名前空間を解釈する機能は無い。

- 承認済みの Residual を参照する抑止は「承認済みの例外」として通る。
- 未承認の Residual を参照する抑止は、plan では「承認待ち」の警告にして作業を止めない。final では強制範囲内で失敗する（範囲外は警告）。
- Residual ID の無い抑止と、存在しない ID を参照する抑止は、強制範囲や旧 schema の warn モードにかかわらず、plan と final の両方で失敗する。書式・規則 ID・配置が不正な場合も同じ扱いとする。

Agent は `approved_by` を記入しないので、Agent が自分で抑止を書いても、強制範囲内の final は通らない。quality.md の Residual Risk 節は承認者と日付をエントリ単位で検査できないため、参照先にしない。抑止コメントは E2E ルート配下にあるので、Residual の承認後に抑止を増やすと evidence の revision 検査で再実行が必要になる。

### E2E 層の Mutation を対象外にする理由

E2E の 1 回の実行は数分単位で、変異体ごとにアプリ全体の再ビルドとブラウザ実行が要る。CI の時間と費用が Mutation から得る情報量に見合わない。さらに E2E の結果は環境とフレークの影響を受けるので、生き残った変異体が「Oracle が弱い」のか「実行が不安定」なのかを区別できず、判定が決定的にならない。E2E Oracle の強さは、この lint の静的な弱アサーション検査と、Unit / Integration 層の Mutation で補う。型解決を伴う検査（変数経由のロケーター文字列の追跡など）と自動修正（`--fix`）も提供しない。

## シナリオ対応表（回帰の保護範囲）

`node scripts/testkit-gate.mjs coverage` は、`openspec/specs` の全シナリオが今どのテストで守られているかを一覧にする。archive 済み change の `test-plan.md` を集め、同じ change の delta spec でシナリオを含むファイルのパスから capability を決める。テストのタグは付け替えない。既存の `@<change-id>` と `@TP-NNN` をそのまま使う。

```bash
node scripts/testkit-gate.mjs coverage [--results <path>] [--max-age <秒>] [--strict] [--format markdown|json]
```

### 分類の意味

| 分類 | 意味 | 保護に数えるか |
|---|---|---|
| 保護（E2E） | 最後にそのシナリオへ行を書いた archive 済み change の TP が割り当てている | 数える |
| 保護（他層の宣言） | `## 対象外シナリオ` の行だけが割り当てている。Oracle、Layer、Method を表示する。実行結果は照合しない | 「他層の宣言を含む」保護率にだけ数える |
| 未保護 | どの archive 済み change の行も割り当てていない。進行中の change だけが割り当てている場合は「進行中: <id>」と補足する | 数えない |
| 要再確認 | TP または対象外行を書いた change より後の change が、そのシナリオを含む Requirement を MODIFIED（再 ADDED・RENAMED も含む）し、その change は同じシナリオに行を書いていない | 数えない |
| 孤立 | TP が指すシナリオが main spec に無い。REMOVED・RENAMED した change を理由欄に出す。テストの削除または付け替えを検討する | 数えない |
| 対応不明 | 旧形式として分類されない行や plan の診断で、TP-ID・表の列名や見出しが不正、シナリオ名が空、plan が欠落、delta に該当シナリオが無い、または複数箇所に一致する。理由を表示する | 数えない |
| 旧形式・対応不明 | 旧 `spec-driven-e2e` または frontmatter のない旧形式で、TP-ID の書式・表・シナリオの不備、表の外の TP、plan の欠落などを理由付きで表示する | 数えない |

前後関係は archive フォルダ名（`YYYY-MM-DD-<id>`）の順で決める。同じ日付は名前の辞書順である。git の履歴は使わない。シナリオは capability、Requirement、シナリオ名の完全一致で照合し、前後の空白だけを無視する。シナリオ名や Requirement 名を変えると、古い TP は「孤立」、新しい名前のシナリオは「未保護」として同時に出る。旧 `spec-driven-e2e` は TP-ID とシナリオ名（`Scenario` または `対応シナリオ` 列）を持つ表の行だけを使い、`E2E対象外` の表は読まない。旧 `quality-driven` の test-plan は対応に使わないが、delta spec は要再確認・孤立の判定に使い、集計の archive 件数にも含める。main spec・archive の Requirement / Scenario / 操作見出しの誤記、不正な `.openspec.yaml`、日付の無い archive フォルダ名、MODIFIED の Requirement 名の大小文字違いは入力エラーとする。archive の名前はそれ以前の履歴で確認できる名前と比較し、REMOVED で消した名前や RENAMED の旧名は以後の比較から外す。現在の main spec や将来の archive の名前とは比較しない。進行中 change はシナリオのない Requirement も含め、現在の main spec の名前と比較する。同じ change 内の RENAMED は新名での MODIFIED を許容する。Requirement / Scenario（Scenaro の誤記を含む）で始まる見出しは、階層・空白・コロンの有無にかかわらず検査する。説明用の `#` / `## Requirement overview` と `#` / `## Scenario overview` は許容する。進行中 change の入力書式の不備は change ごとの警告にして、その注記だけを除外する。I/O エラーや予期しない内部例外は警告に変換しない。他の対応表や strict の判定は続ける。test-plan の欠落は `quality-driven-e2e` と `spec-driven-e2e` だけで診断し、`spec-driven` では診断しない。change の schema が未指定なら `openspec/config.yaml`（無ければ `config.yml`）の schema を既定値に使う。空・コメントのみの config は schema 未指定とする。不正な YAML、mapping 以外の値、文字列でない schema、schema の値または config 全体に付いた独自タグはファイル名と理由を表示して終了コード 2 にする。schema 以外のキーに付いた独自タグ（例: `context: !include x.md`）は無視する。解決できる YAML アンカーは許容する。両方に指定が無い場合は plan の欠落を診断しない。`QE_SCHEMA` で指定した独自の旧 QE schema も `quality-driven` と同じく test-plan を除外し、未知の schema の警告は出さない。未知の schema 名は指定元のファイル名とともに警告し、同じ config の警告は一度だけ表示する。test-plan を保護に使わず delta は判定に使う。解析できない TP は理由付きで対応不明に表示する。対象外行でも `対応シナリオ` 列を受け付け、シナリオ名が空の行は対応不明にする。対象外表の見出しの誤記（`対象外` または `E2E対象外` で始まる `## 対象外シナリオ` 以外の見出し）・重複・階層や空白の不備は、正常な TP 表があっても理由付きで診断する。`対象外 メモ` のような説明用の見出しは診断しない。表の代わりに箇条書きで書かれた宣言も診断し、保護に数えない。シナリオ列自体が無い場合は、空のセルとは区別して列名の不備を表示する。本文中の TP-ID は大文字の独立した参照だけを拾い、`fixtures/tp-001-user.json` のようなファイル名は拾わない。

`## E2E観点一覧` と `## 対象外シナリオ` は、通常の小見出しの下の表も同じ節として読み、表ごとにヘッダと列順を解釈する。`#` / `##` の見出し、`E2E観点一覧` で始まる見出し、`対象外` または `E2E対象外` で始まる見出しは、階層や空白にかかわらず節を区切る。ただし `対象外` の直後（空白と `の` を挟んでもよい）に `メモ` / `補足` / `注` / `備考` / `Notes` が続く説明用の小見出しは節を区切らない。先頭の 1〜3 空白は spec と plan の見出しで許容する。フェンス内の見出し・表・TP-ID とインデントした説明文は無視する。既存 plan との互換性のため、フェンス外のインデントしたパイプ表は対応として読む。

`###### 対象外 メモ` のような説明用の小見出しや、spec 本文の `#requirement-tag` は不正な宣言として扱わない。ただし単独の `#Requirement`、全角コロンや括弧を使った Requirement / Scenario 見出しは入力エラーになる。対象外の表がヘッダ行だけの場合や、表と箇条書きの宣言が混在する場合も理由を表示し、正常な表の行は引き続き対応に使う。`- 補足: …` や小見出しの下のメモは診断しない。箇条書きの診断は `Scenario:` / `Layer:` などの欄名、または `S: Unit` のようにコロンの後にテスト層（Unit / Integration / Contract / Manual / E2E / 単体 / 結合 / 手動）を書く宣言を対象とする。

バッククォートの info 文字列にバッククォートが含まれる行はフェンスの開始にしない。フェンスは同じ記号、開始以上の長さ、info 文字列なしの行でのみ閉じる。閉じていないフェンスは spec と plan の両方で診断し、main spec・archive では終了コード 2、進行中 change では警告にして注記から除外する。参照先のない YAML エイリアスは解析エラーであり、config と archive では終了コード 2、進行中 change ではその注記だけを警告付きで除外する。

`--results` に Playwright の全量実行 JSON を渡すと、TP を持つ行に結果を添える。照合は change id と TP-ID の両方のトークン完全一致で、`e2e-report.mjs` と attempt の状態分類を共有する。coverage の集計では expected-fail（`test.fail()`）を fail に数える（レポーターは fail 件数に含めず、TP のカバレッジ欠落として扱う）。同じシナリオに複数の TP がある場合も、同じ TP が複数ブラウザで実行された場合も、fail、未実行、pass の順で最も悪い結果を使う。集計の bucket は入力の順序に依存しないが、同じ順位の結果が複数ある場合、詳細の status は先に現れた結果を使う。flaky は pass として扱い「pass（flaky）」と表示する。attempt の無いテストと skip は「未実行」になる。別 change に同じ TP-ID があっても流用しない。fail と未実行は「実行で確認済み」に数えない。結果 JSON が読めない、構造が壊れている、suites のネストが 256 階層を超える、トップレベルの `errors` に実行エラーがある、または `--max-age` を超えている場合は表を出さずに終了コード 2 で止まる。

「実行で確認済み」「fail」「未実行」の集計は「保護（E2E）」の行だけを数える。要再確認の行にも結果は表示するが集計には含めない。下の例の Search by keyword は要再確認のため、結果欄が未実行でも集計の「未実行: 0」と矛盾しない。

既存の `e2e-report.mjs` も共有検証を使うため、suites 欠落・トップレベル errors を含む不正 JSON は終了コード 2 になる（従来の 1 または 3 からの変更）。正常入力の終了コードは変わらない。

終了コードは、既定が 0（表を出すだけ）、`--strict` で未保護・要再確認・孤立・fail・未実行のいずれかがあれば 1、入力の欠落・破損・鮮度違反、I/O エラーと引数の誤りは 2、予期しない内部例外はスタックトレース付きの 3 である。`--strict=false` は strict を無効にし、`--strict=true` または `--strict` は有効にする。対応不明と旧形式・対応不明は strict の判定に含めないが、該当シナリオは未保護として現れる。シナリオが 0 件のときは 0 件と表示し、保護率は算出しない。`--format json` は同じ内容を `scenarios`、`orphans`、`unresolved`、`legacyUnresolved`、`summary` と任意の `warnings` に分けて出す。

JSON 出力の各フィールドは次のとおりである。配列が空の場合は `[]`、対応や結果が無い場合は `null` を出す。

| フィールド | 内容 |
|---|---|
| `scenarios[]` | `capability`、`requirement`、`scenario`、`classification` と、以下の `source`、`active`、`result` |
| `scenarios[].source` | 出所の `change` と `archive`。TP は `tps`（ID 配列）、他層の宣言は `declared[]`（`oracle`、`layer`、`method`）。要再確認では `modifiedBy` と `operation`（ADDED / MODIFIED / RENAMED）も付く |
| `scenarios[].active` | 同じシナリオを割り当てる進行中 change ID の配列 |
| `scenarios[].result` | `bucket`（pass / fail / 未実行）、`flaky`、`tps[]`（`id`、`status`、`bucket`、`flaky`）。他層の宣言は文字列「宣言のみ（実行結果は未照合）」 |
| `orphans[]` | `change`、`archive`、`id`、`capability`、`requirement`、`scenario`、`reason` |
| `unresolved[]` / `legacyUnresolved[]` | `change`、`archive`、`id`、`requirement`、`scenario`、`reason`。plan 全体の診断では `id` は `-` |
| `warnings` | 警告がある場合だけ出力する文字列配列。進行中 change の除外理由や未知の schema 名を含む。stderr にも出し、Markdown 形式を選んだ場合は本文にも出す |
| `summary` | `scenarios`、各分類名の件数、`needsAction`、`coverageE2E`、`coverageWithDeclared`。結果付きでは `実行で確認済み`、`fail`、`未実行`、`coverageConfirmed` も付く。保護率は `{count, total, percent}`、シナリオ 0 件では `null` |

kit のリポジトリでは fixture で動作を確認できる。fixture は git 管理外の場所へコピーしてから実行する（git の中では最上位ディレクトリを repo とみなすため）。

```bash
cp -R test/fixtures/coverage/repo /tmp/coverage-demo
cd /tmp/coverage-demo
node <kit>/payload/scripts/testkit-gate.mjs coverage --results <kit>/test/fixtures/coverage/regression-results.json
```

出力の一部（表の行と集計）は次のとおりである。

<!-- coverage-example:start -->
```text
| billing/invoice | Invoice export | Export CSV | 要再確認 | add-invoice TP-001 ／ change-export で MODIFIED | pass |
| billing/invoice | Invoice print | Print invoice | 保護（E2E） | update-print TP-001 | pass（flaky） |
| cart | Add item | Add item when out of stock | 保護（他層の宣言） | add-cart 対象外: Oracle O2 / Layer Unit / Method stock service unit test | 宣言のみ（実行結果は未照合） |
| cart | Show total | Show tax | 未保護 | 進行中: add-tax |  |
| cart | Checkout button | Empty cart | 保護（E2E） | add-cart TP-002 | fail |
| search | Search | Search by keyword | 要再確認 | legacy-search TP-001 ／ legacy-qe で MODIFIED | 未実行 |
| add-invoice | TP-003 | billing/invoice | Invoice email | Email invoice | REMOVED（drop-email） |
- シナリオ: 13 件（archive 済み change 9 件から集計）
- 実行で確認済み: 2 / fail: 1 / 未実行: 0
- 保護率（E2E）: 3/13（23.1%）
- 保護率（他層の宣言を含む）: 4/13（30.8%）
- 保護率（実行で確認済み）: 2/13（15.4%）
- 要対応: 12
```
<!-- coverage-example:end -->

### 段階的な導入

1. update 後に `node scripts/testkit-gate.mjs coverage` をローカルで実行し、既存の archive からどれだけ対応が取れるかを見る。最初は未保護が多く出る想定である。
2. 孤立と要再確認を先に片付ける。孤立はテストの削除か、新しいシナリオ名への test-plan の修正で消える。要再確認は、Requirement を変えた change の test-plan に TP か対象外行を追加するまで残る。archive 済みの test-plan を直す場合は、通常の change として変更する。
3. CI の reusable workflow に `regression-command` を設定し、全量実行の結果を表に添える。この段階では `coverage-strict` を付けず、job の成果物（`test-results/testkit/<run>/coverage.md` と `coverage.json`）を確認するだけにする。
4. 要対応が十分減ったら `coverage-strict: true` にして、未保護・要再確認・孤立・fail・未実行を job の失敗にする。

対応表は archive や plan/final 検査の必須条件ではない。対応状況によって CI を失敗させるのは `coverage-strict` を明示したときだけである。入力エラー・内部エラー・回帰コマンドの失敗は strict の有無によらず失敗となる。
