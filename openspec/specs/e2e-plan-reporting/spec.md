# e2e-plan-reporting Specification

## Purpose
仕様シナリオとE2Eの実施範囲を明示し、changeとTP-IDの組に対して実行結果を照合する。別changeの結果や古いレポート、skipだけの実行を成功と誤認せず、既存の呼出し形式と結果コードを維持する。

## Requirements

### Requirement: Explicit applicability and complete scenario mapping

統合test-planのfrontmatter e2e を required または not-applicable の唯一の適用状態として MUST 使用する。全specシナリオをE2E観点または理由付きの別層へ割り当て、qualityの層選択と矛盾する状態を拒否する。

#### Scenario: Missing or inconsistent applicability

- **WHEN** e2eが不明・欠落・不正、またはqualityがE2Eを要求するのにnot-applicableである
- **THEN** 明示的対象外と扱わず失敗する

#### Scenario: Justified non-applicability

- **WHEN** すべてのシナリオを代替検証へ委譲する
- **THEN** 理由と具体的な代替Oracle・検証方法を確認して当該changeのE2Eだけを不要とし、他changeとsmokeを維持する

#### Scenario: Empty plan

- **WHEN** requiredでTP-IDが0件、またはnot-applicableで理由・代替検証が空である
- **THEN** 空の計画による回避として拒否する

### Requirement: Scoped test identifiers

各E2E観点はTP-001からのID、Requirement / Scenario、Risk / Oracle、fixture、操作意図、期待結果を MUST 持つ。対応テストには正確な @<change-id> と @TP-NNN を付け、changeとTP-IDの組で照合する。

#### Scenario: Same TP identifier in another change

- **WHEN** add-aのTP-001が不足し、add-abまたは別changeにTP-001の成功結果がある
- **THEN** add-aの不足は解消せず、prefix一致や正規表現誤解釈で混同しない

#### Scenario: Tags exist but test did not run

- **WHEN** ソースにはタグがあるが今回の結果に当該テストがない
- **THEN** 存在チェックと実行coverageを分け、未実行として不足を報告する

### Requirement: Execution result semantics

requiredでは実行された成功またはリトライ後成功の結果だけをcoverageに MUST 数える。flakyは成功として数えつつ明示し、失敗、skip、0件、未知status、実行attemptのない結果を成功に数えてはならない。

#### Scenario: Skipped or empty execution

- **WHEN** requiredの全テストがskipまたは0件である
- **THEN** coverage欠落として失敗する

#### Scenario: Flaky retry succeeds

- **WHEN** 実行attemptのあるテストがリトライ後成功する
- **THEN** passとflakyを両方表示し、失敗のまま複数attemptがあるテストをflaky成功にしない

#### Scenario: Test failure and missing coverage coexist

- **WHEN** 対象テストに失敗とTP-ID欠落が両方ある
- **THEN** 両方を報告し、テスト失敗の終了コード3を返す

### Requirement: Reporter interface and freshness

レポータは <change-id> [results.json] [--max-age seconds] と終了コード0成功・1coverage欠落・2入力/鮮度エラー・3テスト失敗を MUST 維持する。実行開始時刻を表示し、--max-age指定時は古いJSONや時刻欠落を拒否する。統合CIは実行単位の出力分離とrevisionの記録により前回結果の再使用を防ぐ。

#### Scenario: Stale missing or malformed report

- **WHEN** レポートが欠落・不正JSON、またはmax-age超過・時刻なしである
- **THEN** 対象結果を成功とせず終了コード2で診断する

#### Scenario: A later run writes no report

- **WHEN** 前回は成功したが今回のPlaywrightがJSON生成前に失敗する
- **THEN** 前回JSONを流用せず、今回の実行失敗またはレポート欠落をjob失敗に反映する

#### Scenario: Legacy reporter invocation

- **WHEN** 旧形式test-planに既存の引数でレポータを実行する
- **THEN** 新frontmatterを遡及要求せず、結果表、時刻、flaky表示、終了コードの意味を保持する

### Requirement: Project-scoped TP coverage

統合 test-plan の `## E2E観点一覧` は任意の `Projects` 列を MAY 持つ。値は Playwright project 名を `,` または `、` で区切る。統合 plan の `Projects` に似た別名（`Project`・`projects`・`Projects（任意）`・`Projets`・`プロジェクト`・`Playwright Projects`・`Ｐｒｏｊｅｃｔｓ` など）、重複列、空の列名は計画ゲートで MUST 拒否する。列名は NFKC 正規化後に記号・空白を除き、小文字にした結果に `project`・`projet`・`プロジェクト` を含むものを予約する。正確な `Projects` 以外は、`Project Owner`・`担当プロジェクト`・`Subproject`・`Projection` など独自列の意図でも拒否する。それ以外の追加列（`備考`・`Notes`・`優先度` など）は従来どおり無視する。reporter は schema にかかわらず frontmatter がある plan に同じ見出し検査を行い、違反は入力エラー（終了コード 2）とする。frontmatter の無い旧 plan は見出し検査の対象外とする。統合 plan の TP-ID は大文字の `TP-` と3桁の数字を必須とし、不正な行を黙って除外しない。reporter も frontmatter がある plan で同じ TP-ID 検査を行い、不正な TP-ID または `not-applicable` に TP 行がある場合は入力エラー（終了コード 2）にする。表を分けるときは見出し行と区切り行を MUST 付ける。区切り行は見出し行の次の行だけとし、それより後の `| - | - |` のような行は TP 行として検査する。空行やコードフェンスで切れた`TP-ID` の見出し行で始まらない表の断片、TP-ID 列の無い表、閉じていないコードフェンスは、行を黙って除外せず計画ゲートで MUST 失敗させ、frontmatter がある plan は reporter でも入力エラー（終了コード 2）にする。`#` / `##` の見出しに加え、`E2E観点一覧` または `対象外` で始まる見出しは階層にかかわらず節を区切る。TP を読むのは `## E2E観点一覧` の節だけで、それ以外の `E2E観点一覧` / `対象外` で始まる見出し（`### E2E観点一覧の補足`・`### 対象外ブラウザ` など。`## 対象外シナリオ` は除く）の下に TP-ID 列の表や TP-ID がある plan は、計画ゲートで MUST 失敗させ、frontmatter がある plan は reporter でも入力エラー（終了コード 2）にする。計画ゲート・reporter・coverage は同じ節の同じ表から TP を読む。値がある TP は、指定した全 project で、その change と TP-ID のタグを持つテストに実 attempt の pass（expected または flaky）がある場合だけ coverage に MUST 数える。列が無い、または値が空の TP は従来どおり、いずれかの project の pass で数える。終了コードの意味（0/1/2/3）は変えない。

#### Scenario: One project is missing

- **WHEN** TP-002 の Projects が `chromium, mobile-safari` で、結果 JSON には chromium の pass だけがある
- **THEN** reporter は TP-002 を mobile-safari 未実行の coverage 欠落として報告し、終了コード 1 を返す

#### Scenario: One project fails

- **WHEN** TP-002 が chromium で pass し、webkit で fail した
- **THEN** reporter は失敗として終了コード 3 を返す

#### Scenario: Plan without the column

- **WHEN** 既存 test-plan に Projects 列がない
- **THEN** reporter は従来と同じ判定と出力をする

#### Scenario: Duplicate or blank project names

- **WHEN** Projects に `chromium, , chromium` のように空要素や重複がある
- **THEN** 計画ゲートは空要素を不正として失敗し、重複は1つにまとめて扱う
