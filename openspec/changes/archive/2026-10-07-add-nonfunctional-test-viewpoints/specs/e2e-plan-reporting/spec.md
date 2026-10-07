# Spec Delta

## ADDED Requirements

### Requirement: Project-scoped TP coverage

統合 test-plan の `## E2E観点一覧` は任意の `Projects` 列を MAY 持つ。値は Playwright project 名を `,` または `、` で区切る。統合 plan の不明な列名や重複列は計画ゲートで MUST 拒否し、reporter 単体でも入力エラー（終了コード 2）とする。値がある TP は、指定した全 project で、その change と TP-ID のタグを持つテストに実 attempt の pass（expected または flaky）がある場合だけ coverage に MUST 数える。列が無い、または値が空の TP は従来どおり、いずれかの project の pass で数える。終了コードの意味（0/1/2/3）は変えない。

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
