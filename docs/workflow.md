# ワークフロー

## 人間が行うこと

統合 schema では low を含むすべての Risk で、次を人間が行う。

1. `quality.md` の `approved_by` と `approved_at`（YYYY-MM-DD）を記入する。
2. Oracle を読んで `scripts/qe-gate.sh seal <change>` を実行する。
3. 反証の Residual を承認する。medium 以上は Human Code Review、high はドメイン担当を含める。

Agent は承認欄、`oracle_digest`、seal を埋めない。apply の指示は、未承認または未 seal のとき実装を止める。`scripts/qe-gate.sh seal` は本人確認をしない。誰が実行したかの保証は CODEOWNERS とブランチ保護に依存する。

役割の入力範囲は `openspec/roles/oracle-writer.md` と `openspec/roles/falsifier.md` が正本である。Claude の adapter は `.claude/agents/` からその定義を参照する。design と実装会話は Oracle の期待値に渡さない。別セッションを起動できない環境では、同じ会話の続きで Oracle や反証を書かず、人間に別セッションの開始を依頼して止まる。

E2E 層の Oracle は test-plan の TP で観測する。同じ観測を単体テストとして再実装しない。Unit 層の Oracle に TP-ID は不要である。

## 計画と適用

`skip_specs: true` のとき specs は skipped になり、架空の spec は作らない。quality と test-plan は proposal と変更範囲から書く。OpenSpec 1.13.1 では、skipped な specs のあと quality は ready になる。tasks まで揃うと、evidence が無くても apply は ready になる。

全タスク完了、または archive へ移した change は、CI の `gate-phase` が plan でも final として検査する。

統合 schema の seal 検査は、番号 2 以降のタスクの完了を実装開始とみなす。番号のないタスクは、それを含む見出しのうち最も近い番号付き見出し（`## N.` など）の番号で扱う。番号付きの見出しの下にないものは実装タスクとして扱う。旧 `quality-driven` は、番号 2 以降の完了だけを見る旧来の判定を維持する。

## E2E 規約 lint

e2e 適用状態が required の change（旧 `spec-driven-e2e` を含む）では、`testkit-gate.mjs check` が E2E ルート配下の `.js` / `.ts` 系ソースを静的に検査する。規則は固定待機（`fixed-wait`）、禁止ロケーター（`forbidden-locator`）、実行の除外・反転（`excluded-test`）、タグ欠落（`missing-tag`）、アサーション欠落（`missing-assertion`）、存在確認だけのアサーション（`weak-assertion`）である。規約との対応表は `.claude/skills/e2e-conventions/SKILL.md` にある。`.feature` は手続きを持たないので対象外とし、`lint` の一覧に「対象外」と表示する。

E2E required の change が検査対象にある場合、強制範囲は「検査対象 change のタグを持つテストソース」と「比較元から HEAD までの差分で変更された E2E ソース」の和である。前者は新しい TP の弱さを、後者はタグの無い既存ファイルからアサーションを消す後退を止める。手を付けていない既存ファイルの指摘は警告に留め、導入先が一斉に失敗しないようにする。差分は `selectChanges` が解決した merge-base から取る。`--base` が無いローカル実行では差分による強制は行わない。`scope: all` なら全ソースを、それ以外はタグ範囲だけを強制し、その旨を表示する。未コミットの変更は HEAD との差分に含めない。CI では reusable workflow の `base-ref` を必ず渡す。E2E required の change が無い PR では `check` / CI の lint は起動しない。既存 E2E の後退をゲートで止める場合も、対応する required change を含める。

強制範囲内で読めない、または字句解析できないソースは失敗にする。指摘なしとしては扱わない。

フレークの隔離は lint の例外ではない。隔離を理由にした `test.skip` / `test.fixme` も lint は除外の指摘として残す。fixture と mock の登録検査はこの lint では扱わない。`fixed-wait` は別名に代入した `setTimeout` を追跡しない。`missing-tag` は active / archive の change ID と照合し、`@smoke` などの一般タグだけでは通さない。

`node scripts/testkit-gate.mjs lint [--phase plan|final] [--base <ref>] [<change>...]` は E2E ルート全体の指摘を強制範囲と警告範囲に分けて表示する。`--phase` の既定値は `plan`。検査ファイル数も表示する。終了コードは強制範囲の失敗、不正な抑止・設定、入力の読み取り失敗、検査ソース 0 件、change 選択・適用状態の判定失敗があれば 1、引数の誤りは 2、それ以外は 0 である。test-plan 未作成の計画途中の change は、適用状態の判定失敗に含めない。対象 change が 0 件でもソースを検査できれば警告一覧を表示する。`check` の終了コードの意味は変わらない。

欄が無い場合は既定値（`enforce` / `changed`）で動く。doctor は欄が無いことを note として表示するが、失敗にはしない。policy の不正値・未知の `e2e_lint_*` キーと、旧 schema に適用する環境変数の不正値は `invalid-config` として失敗する。統合 schema では環境変数を引き続き無視する。対象 change が無い lint でも、不正な環境変数は診断して失敗する。

### 例外の承認

XPath の引数検査では、`page` / `p2` / `popup` / `frame`、末尾が `Page` / `Frame` の名前、`frame()` / `*Frame()` の戻り値を Page / Frame の受け手として扱う。型解析は行わないため、それ以外の名前では `fill()` 等の値引数を XPath と判定しない。`setInputFiles()` の `./` / `../` はファイルパスとして扱う。`locator()` 等の禁止メソッドの検出は受け手によらない。

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
