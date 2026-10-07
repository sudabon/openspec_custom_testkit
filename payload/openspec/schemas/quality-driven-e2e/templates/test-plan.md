---
e2e: required
reason: ""
alternative_verification: []
---

# Test Plan

仕様の正本は specs のシナリオです。このファイルで新しい振る舞いを定義しません。design.md の文章を期待値にしません。

`e2e: required` のとき、下の観点表に TP を 1 件以上書きます。`e2e: not-applicable` のときは reason と alternative_verification（oracle, layer, method）を書き、観点表の TP 行は置きません。

## E2E観点一覧

`Projects` 列は任意です。Playwright project 名を `,` または `、` で区切って書いた TP は、書いた全 project で pass したときだけ coverage に数えます。空欄なら、いずれかの project の pass で数えます。列名は下表の表記を使います。`Projects` に似た列名（`Project`・`Projects（任意）`・`プロジェクト`・`Playwright Projects`・`Ｐｒｏｊｅｃｔｓ` など）、重複列、空の列名はエラーになります。列名は NFKC 正規化後に記号・空白を除き、小文字にした結果に `project`・`projet`・`プロジェクト` を含むものを予約します。正確な `Projects` 以外は、`Project Owner`・`担当プロジェクト`・`Subproject`・`Projection` など独自列の意図でも拒否します。それ以外の追加列（`備考` や `Notes` など）は無視します。TP-ID は `TP-001` のように大文字の `TP-` と3桁の数字で書きます。不正な TP-ID と、`not-applicable` なのに TP 行がある計画は、reporter 単独でも入力エラーになります。表を分けるときは見出し行と区切り行を付けます。空行やコードフェンスで切れた、`TP-ID` の見出し行で始まらない表の断片、TP-ID 列の無い表、閉じていないコードフェンスはエラーになるので、TP 以外の表は別の節に置きます。

| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected | Projects |
|-------|-------------|----------|------|--------|---------|--------|----------|----------|
| TP-001 | | | R1 | O1 | | | | |

## 対象外シナリオ

| Scenario | Reason | Oracle | Layer | Method |
|----------|--------|--------|-------|--------|

## タグ対応

実装するテストには `@<change-id>` と `@TP-NNN` を同じテストへ付けます。タグの存在だけでは実行 coverage になりません。
