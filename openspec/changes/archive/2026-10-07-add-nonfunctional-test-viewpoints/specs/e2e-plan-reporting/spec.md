# Spec Delta

## ADDED Requirements

### Requirement: Project-scoped TP coverage

統合 test-plan の `## E2E観点一覧` は任意の `Projects` 列を MAY 持つ。値は Playwright project 名を `,` または `、` で区切る。統合 plan の `Projects` に似た別名（`Project`・`projects`・`Projects（任意）`・`Projets`・`プロジェクト`・`Playwright Projects`・`Ｐｒｏｊｅｃｔｓ` など）、重複列、空の列名は計画ゲートで MUST 拒否する。列名は NFKC 正規化後に記号・空白を除き、小文字にした結果に `project`・`projet`・`プロジェクト` を含むものを予約する。正確な `Projects` 以外は、`Project Owner`・`担当プロジェクト`・`Subproject`・`Projection` など独自列の意図でも拒否する。それ以外の追加列（`備考`・`Notes`・`優先度` など）は従来どおり無視する。reporter は schema にかかわらず frontmatter がある plan に同じ見出し検査を行い、違反は入力エラー（終了コード 2）とする。frontmatter の無い旧 plan は見出し検査の対象外とする。統合 plan の TP-ID は大文字の `TP-` と3桁の数字を必須とし、不正な行を黙って除外しない。reporter も frontmatter がある plan で同じ TP-ID 検査を行い、不正な TP-ID または `not-applicable` に TP 行がある場合は入力エラー（終了コード 2）にする。表を分けるときは見出し行と区切り行を MUST 付ける。区切り行は見出し行の次の行だけとし、それより後の `| - | - |` のような行は TP 行として検査する。空行やコードフェンスで切れた`TP-ID` の見出し行で始まらない表の断片、TP-ID 列の無い表、閉じていないコードフェンスは、行を黙って除外せず計画ゲートで MUST 失敗させ、frontmatter がある plan は reporter でも入力エラー（終了コード 2）にする。`#` / `##` の見出しに加え、`E2E観点一覧` または `対象外` で始まる見出しは階層にかかわらず節を区切る。TP を読むのは `## E2E観点一覧` の節だけとする。それ以外の節（`## 補足`・`# Appendix`・`## 対象外シナリオ` の下の小見出しなど）や最初の見出しより前に TP-ID 列の表がある plan、および `## 対象外シナリオ` 以外の `E2E観点一覧` / `対象外` で始まる見出し（`### E2E観点一覧の補足`・`### 対象外ブラウザ` など）の下で TP-ID を参照する plan は、計画ゲートで MUST 失敗させ、frontmatter がある plan は reporter でも入力エラー（終了コード 2）にする。TP-ID の参照は coverage と同じく、前後が英数字・`.`・`/`・`_`・`-` でない大文字の `TP-数字` だけを数える（`HTTP-2` や `tests/e2e/TP-001.spec.ts` は参照ではない）。計画ゲート・reporter・coverage は同じ節の同じ表から TP を読む。値がある TP は、指定した全 project で、その change と TP-ID のタグを持つテストに実 attempt の pass（expected または flaky）がある場合だけ coverage に MUST 数える。列が無い、または値が空の TP は従来どおり、いずれかの project の pass で数える。終了コードの意味（0/1/2/3）は変えない。

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
