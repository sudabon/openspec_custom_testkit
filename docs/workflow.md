# ワークフロー

## 人間が行うこと

統合 schema では low を含むすべての Risk で、次を人間が行う。

1. `quality.md` の `approved_by` と `approved_at`（YYYY-MM-DD）を記入する。
2. Oracle を読んで `scripts/qe-gate.sh seal <change>` を実行する。
3. 反証の Residual を承認する。medium 以上は Human Code Review、high はドメイン担当を含める。
4. QA handoff が必要な change では、QA が手動確認範囲と探索チャーターを実施し、`qa-handoff.md` の QA 実施結果を記入する。

Agent は承認欄、`oracle_digest`、seal を埋めない。apply の指示は、未承認または未 seal のとき実装を止める。`scripts/qe-gate.sh seal` は本人確認をしない。誰が実行したかの保証は CODEOWNERS とブランチ保護に依存する。

役割の入力範囲は `openspec/roles/oracle-writer.md` と `openspec/roles/falsifier.md` が正本である。Claude の adapter は `.claude/agents/` からその定義を参照する。design と実装会話は Oracle の期待値に渡さない。別セッションを起動できない環境では、同じ会話の続きで Oracle や反証を書かず、人間に別セッションの開始を依頼して止まる。

E2E 層の Oracle は test-plan の TP で観測する。同じ観測を単体テストとして再実装しない。Unit 層の Oracle に TP-ID は不要である。

## 計画と適用

`skip_specs: true` のとき specs は skipped になり、架空の spec は作らない。quality と test-plan は proposal と変更範囲から書く。OpenSpec 1.13.1 では、skipped な specs のあと quality は ready になる。tasks まで揃うと、evidence が無くても apply は ready になる。

全タスク完了、または archive へ移した change は、CI の `gate-phase` が plan でも final として検査する。

統合 schema の seal 検査は、番号 2 以降のタスクの完了を実装開始とみなす。番号のないタスクは、それを含む見出しのうち最も近い番号付き見出し（`## N.` など）の番号で扱う。番号付きの見出しの下にないものは実装タスクとして扱う。旧 `quality-driven` は、番号 2 以降の完了だけを見る旧来の判定を維持する。

## Manual 層と QA handoff

統合 schema の quality.md の Test Layer Mapping は `Static` / `Unit` / `Integration` / `E2E` / `Monitoring` に加えて `Manual` を受け付ける。`Manual` は人が手で確認する層で、探索テストを含む。Layer 列にはこの6つの名前（大文字小文字は問わない）だけを空白・`/`・`,`・`、`・`+`・`・` で区切って書く。`手動` や `Exploratory`、綴りの誤りなど、それ以外の語があると計画ゲートが Failure Mode の ID と値を示して失敗する。`Manual` を選んだ行には Failure Mode の ID と、選定理由の欄に自動化しない理由を書く。どちらかが空なら計画ゲートが失敗する。`Manual` は E2E 層ではない。E2E 層かどうかは Layer 列だけで判定し、選定理由の欄に `E2E` と書いても E2E 層にはならない。層が `Unit` と `Manual` だけなら test-plan を `e2e: not-applicable` にしてよく、`Manual` を理由に `e2e: required` にはしない。

quality.md の Residual Risk は `## Residual Risk` 見出しの下に箇条書き（`-` / `*` / `+` または `1.` / `1)`、インデント可）で書き、各項目には `- RR1: <保証しないこと>` の形式で ID を付ける。無ければ `- なし` と書く。項目の下に一段深くインデントした箇条書きは、その項目の補足として読む。`## Residual Risk` 見出しが無いとき、また `### Residual Risk`・`## Residual Risks`・`## Residual Risk（残存リスク）`・`## 残存リスク` のような近い見出しがあるときは、計画ゲートが失敗する。Test Layer Mapping の表には見出しが `Layer` で始まる列が必要で、Layer が空の行も計画ゲートで失敗する。空の箇条書きと `なし` / `該当なし` / `None` は Residual なしとみなす。

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

## E2E 規約 lint

e2e 適用状態が required の change（旧 `spec-driven-e2e` を含む）では、`testkit-gate.mjs check` が E2E ルート配下の `.js` / `.ts` 系ソースを静的に検査する。規則は固定待機（`fixed-wait`）、禁止ロケーター（`forbidden-locator`）、実行の除外・反転（`excluded-test`）、タグ欠落（`missing-tag`）、アサーション欠落（`missing-assertion`）、存在確認だけのアサーション（`weak-assertion`）である。規約との対応表は `.claude/skills/e2e-conventions/SKILL.md` にある。`.feature` は手続きを持たないので対象外とし、`lint` の一覧に「対象外」と表示する。

E2E required の change が検査対象にある場合、強制範囲は「検査対象 change のタグを持つテストソース」と「比較元から HEAD までの差分で変更された E2E ソース」の和である。前者は新しい TP の弱さを、後者はタグの無い既存ファイルからアサーションを消す後退を止める。手を付けていない既存ファイルの指摘は警告に留め、導入先が一斉に失敗しないようにする。差分は `selectChanges` が解決した merge-base から取る。`--base` が無いローカル実行では差分による強制は行わない。`scope: all` なら全ソースを、それ以外はタグ範囲だけを強制し、その旨を表示する。未コミットの変更は HEAD との差分に含めない。CI では reusable workflow の `base-ref` を必ず渡す。E2E required の change が無い PR では `check` / CI の lint は起動しない。既存 E2E の後退をゲートで止める場合も、対応する required change を含める。

強制範囲内で読めない、または字句解析できないソースは失敗にする。指摘なしとしては扱わない。

フレークの隔離は lint の例外ではない。隔離を理由にした `test.skip` / `test.fixme` も lint は除外の指摘として残す。fixture と mock の登録検査はこの lint では扱わない。`fixed-wait` は別名に代入した `setTimeout` を追跡しない。`missing-tag` は active / archive の change ID と照合し、`@smoke` などの一般タグだけでは通さない。

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
