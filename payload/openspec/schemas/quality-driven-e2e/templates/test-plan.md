---
e2e: required
reason: ""
alternative_verification: []
---

# Test Plan

仕様の正本は specs のシナリオです。このファイルで新しい振る舞いを定義しません。design.md の文章を期待値にしません。

`e2e: required` のとき、下の観点表に TP を 1 件以上書きます。`e2e: not-applicable` のときは reason と alternative_verification（oracle, layer, method）を書き、観点表の TP 行は置きません。

## E2E観点一覧

`Projects` 列は任意です。Playwright project 名をカンマ区切りで書いた TP は、書いた全 project で pass したときだけ coverage に数えます。空欄なら、いずれかの project の pass で数えます。

| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected | Projects |
|-------|-------------|----------|------|--------|---------|--------|----------|----------|
| TP-001 | | | R1 | O1 | | | | |

## 対象外シナリオ

| Scenario | Reason | Oracle | Layer | Method |
|----------|--------|--------|-------|--------|

## タグ対応

実装するテストには `@<change-id>` と `@TP-NNN` を同じテストへ付けます。タグの存在だけでは実行 coverage になりません。
