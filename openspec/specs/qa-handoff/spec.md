# qa-handoff Specification

## Purpose
統合 schema の change ごとに、自動化で保証した範囲と QA が手で確認すべき残りの範囲を一つの引き継ぎ成果物として出し、その欠落や未記入をゲートで検出することで、QA が全体を再テストせずに済むようにする。

## Requirements

### Requirement: Manual layer requires a reason not to automate
統合 schema の quality.md の Test Layer Mapping は、`Static` / `Unit` / `Integration` / `E2E` / `Monitoring` に加えて `Manual` 層を受け付けなければならない（SHALL）。探索テストも `Manual` に含める。Test Layer Mapping の表には見出しが `Layer` で始まる列がなければならず、無ければ計画ゲートは失敗しなければならない（MUST）。Layer 列が空の行があれば、計画ゲートは Failure Mode の ID を示して失敗しなければならない（MUST）。Layer 列の値はこの6つの名前（大文字小文字は問わない）を空白・`/`・`,`・`、`・`+`・`・` で区切ったものに限り、それ以外の語（`手動`、`Exploratory`、綴りの誤りなど）があれば計画ゲートは Failure Mode の ID と値を示して失敗しなければならない（MUST）。`Manual` を選んだ Failure Mode の行には、Failure Mode の ID と自動化しない理由を書かなければならない（MUST）。どちらかが空なら計画ゲートは失敗しなければならない（MUST）。`Manual` は E2E 層とはみなさない。`Manual` しか無いことを理由に test-plan の `e2e` を required にしてはならない（MUST）。E2E 層かどうかは Layer 列だけで判定し、選定理由の欄の語は使わない。

quality.md の Residual Risk は `## Residual Risk` 見出しの下の箇条書き（`-` / `*` / `+` または `1.` / `1)`、インデント可）として読む。直前の項目より深くインデントされた箇条書きは、その項目の補足として読み、別の Residual とはみなさない。統合 schema の quality.md には `## Residual Risk` 見出しがなければならず、無ければ計画ゲートは失敗しなければならない（MUST）。`### Residual Risk`・`## Residual Risks`・`## Residual Risk（残存リスク）`・`## 残存リスク` のように、`Residual` または `残存リスク` で始まる別の見出しがあれば、計画ゲートは見出しを直すよう示して失敗しなければならない（MUST）。

#### Scenario: Manual layer without a reason
- **WHEN** Test Layer Mapping のある行が `Manual` を選び、選定理由の欄が空である
- **THEN** 計画ゲートはその Failure Mode の ID を示して失敗する

#### Scenario: Unknown layer value
- **WHEN** Test Layer Mapping のある行の Layer が `手動` である
- **THEN** 計画ゲートはその Failure Mode の ID と値を示して失敗する

#### Scenario: Residual Risk heading in another form
- **WHEN** quality.md の Residual Risk の見出しが `### Residual Risk` である
- **THEN** 計画ゲートは `## Residual Risk` にするよう示して失敗する

#### Scenario: Residual Risk heading is missing
- **WHEN** 統合 schema の quality.md に `## Residual Risk` 見出しが無い
- **THEN** 計画ゲートは `## Residual Risk` が無いことを示して失敗する

#### Scenario: Nested note under a residual
- **WHEN** `- RR1: 日付をまたぐ表示` の下に `  - 理由: Green では保証しない` がある
- **THEN** Residual は RR1 の1件として読まれ、ID が無いとして失敗しない

#### Scenario: Layer column is missing or empty
- **WHEN** Test Layer Mapping の表に `Layer` で始まる列が無い、またはある行の Layer が空である
- **THEN** 計画ゲートは失敗し、空の行についてはその Failure Mode の ID を示す

#### Scenario: Manual layer does not imply E2E
- **WHEN** quality.md の層が `Unit` と `Manual` だけで、test-plan が `e2e: not-applicable` である
- **THEN** 層の矛盾としては失敗しない

### Requirement: QA handoff artifact content
kit は統合 schema 用に `qa-handoff.md` テンプレートを提供しなければならない（SHALL）。このテンプレートは次の節を持つ。

- 自動化済み範囲
- 手動確認範囲
- 探索チャーター
- QA 実施結果

自動化済み範囲は evidence の `risk_results` のうち `result` が `pass` の Risk をすべて、Risk・Failure Mode・Oracle・Layer・TP-ID・Run-ID の列で列挙する。Risk・Failure Mode・Oracle・Layer・Run-ID は必須で、TP-ID は E2E 層のときだけ書く。Failure Mode・Oracle・Run-ID は、その Risk の `failure_modes`・`oracles`・`run_ids` に含まれる値でなければならない（MUST）。`pass` でない行を自動化済みとして載せてはならない（MUST）。evidence の Execution Records を読めないときは、照合を省いて警告を1件だけ出す。手動確認範囲は、Manual 層のすべての Failure Mode と、quality.md と evidence の Residual のすべてを ID 付きで載せる。各行は ID・種別（`Manual` または `Residual`）・確認観点・理由を持つ。探索チャーターは1行以上あり、各行は Charter-ID・目的・対象・時間の目安を持つ。各表の ID は重複してはならない。qa-handoff.md は apply の必須 artifact にしてはならない（MUST NOT）。

#### Scenario: Automated scope comes from passing evidence
- **WHEN** evidence の `risk_results` に R1 が `pass`、R2 が `fail` と記録されている
- **THEN** 自動化済み範囲に R2 を載せた qa-handoff.md は final gate で失敗する

#### Scenario: Apply does not wait for the handoff
- **WHEN** tasks.md まで揃い、qa-handoff.md がまだ無い
- **THEN** apply は ready になる

### Requirement: Final gate enforces the handoff
統合 schema の change が final として検査されるとき、次のいずれかに当てはまれば、qa-handoff.md の存在と構造を必須にしなければならない（MUST）。

- Test Layer Mapping に `Manual` の行がある
- quality.md の Residual Risk に空でない項目がある
- evidence の `residuals` が空でない

final gate は次の場合に失敗しなければならない（MUST）。

- qa-handoff.md が無い
- 自動化済み範囲・手動確認範囲・探索チャーター・QA 実施結果のいずれかの節が無い
- quality.md の Residual Risk の項目に `RR1:` の形式の ID が無い、または evidence の `residuals` の項目に `id` が無い
- Manual 層の F-ID または Residual の ID が手動確認範囲に載っていない
- 自動化済み範囲が `pass` の risk_results と一致しない（`pass` でない Risk がある、`pass` の Risk が欠けている、evidence に無い Failure Mode・Oracle・Run-ID がある）
- 自動化済み範囲・手動確認範囲・探索チャーターの必須欄に空欄がある（探索チャーターでは Charter-ID・目的・対象・時間の目安）
- 手動確認範囲の種別が `Manual` / `Residual` 以外である
- 探索チャーターが0行である
- 表の ID が重複している
- テンプレートの記入例が置き換えられずに残っている

どの条件にも当てはまらない change では、handoff を要求してはならない（MUST NOT）。

#### Scenario: Manual failure mode missing from the handoff
- **WHEN** quality.md で F3 が `Manual` 層であり、qa-handoff.md の手動確認範囲に F3 が無い
- **THEN** final gate は F3 を示して失敗する

#### Scenario: Unfilled template is not a handoff
- **WHEN** qa-handoff.md がテンプレートの記入例のまま残っている
- **THEN** final gate は未記入として失敗する

#### Scenario: Nothing left for manual testing
- **WHEN** Manual 層が無く、quality.md と evidence に Residual が無い
- **THEN** qa-handoff.md が無くても final gate は handoff を理由に失敗しない

### Requirement: QA result is human-only and required at archive
QA 実施結果欄（実施者・実施日・判定・所見）は人間だけが記入する（SHALL）。schema の instruction と role 定義は、Agent がこの欄を記入することを禁止しなければならない（MUST）。QA の実施は tasks.md のチェックボックスにせず、この欄だけで管理する。全タスク完了で final 検査が走るためである。PR の final 検査では、この欄が空でも失敗させない。値が不正なときも警告に留め、どの欄が不正かを示す。表に複数の行があれば、最後に記入された行を現在の結果として読む。archive 済みとして検査される change では、実施者、`YYYY-MM-DD` 形式の実施日、`pass` または `fail` の判定が揃っていなければ、不足または不正な欄を示して失敗しなければならない（MUST）。判定が `fail` のときも失敗しなければならない（MUST）。kit は記入者の本人確認をしない。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存することを文書に書かなければならない（MUST）。

#### Scenario: Final check before QA has run
- **WHEN** 全タスクが完了して final 検査が走り、QA 実施結果欄が空である
- **THEN** 結果欄の欠落は警告として表示され、失敗にはならない

#### Scenario: Archive without a QA result
- **WHEN** handoff が必要な change が archive され、QA 実施結果の判定が空である
- **THEN** archive の検査は失敗する

#### Scenario: QA reports a failure
- **WHEN** archive された change の QA 判定が `fail` である
- **THEN** archive の検査は失敗し、所見を修正するか、Residual として承認し直すよう案内する

#### Scenario: QA is run again after a failure
- **WHEN** QA 実施結果の1行目が `fail`、その下の行が再実施の `pass` である
- **THEN** 最後の行の `pass` を現在の結果として読み、archive の検査は判定を理由に失敗しない

### Requirement: Legacy schemas do not require a handoff
旧 `quality-driven` と `spec-driven-e2e` の change には、Manual 層の理由も qa-handoff.md も要求してはならない（MUST NOT）。

#### Scenario: Legacy change with residual risk
- **WHEN** 旧 `quality-driven` の change に Residual Risk がある
- **THEN** handoff の欠落を理由に失敗しない
