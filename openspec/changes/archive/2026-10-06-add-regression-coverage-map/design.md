# Design

## Context

目的は proposal.md「Why」を参照する。

現状の検査は change 単位である。`plan-check.mjs` の `scenariosOf` は `<change>/specs` だけを読み、test-plan の TP 行と対象外行がその change のシナリオを一度ずつ覆うかを確かめる。`report.mjs` は `@<change-id>` と `@TP-NNN` のトークン完全一致で Playwright の結果を照合する。archive 後、main spec と過去の test-plan を結び付ける仕組みはない。

main spec のシナリオには ID がなく、`#### Scenario: <名前>` の名前だけで識別される。test-plan の TP 行の Requirement と Scenario も名前で書かれ、capability の列はない。

## Goals / Non-Goals

**Goals:**

- main spec の全シナリオについて、保護の有無と出所（change id、TP-ID、または他層の宣言）を一つの表で示す。
- 仕様変更でテストが古くなった可能性と、削除済み仕様を指すテストを機械的に示す。
- 既存のタグ、test-plan 形式、gate の終了コードを変えずに導入できる。

**Non-Goals:**

- テストタグの自動付け替えと、main spec への ID の埋め込み。
- 単体・結合テストの実行結果をシナリオ単位で照合すること。他層は test-plan の宣言だけを表示する。
- 対応表の結果を archive や plan/final 検査の必須条件にすること。CI で失敗させるのは `coverage-strict` を明示したときだけ。

## Decisions

### 1. タグを付け替えず、archive 済み test-plan から対応表を組み立てる

代替案は三つあった。

| 案 | 内容 | 判断 |
|---|---|---|
| A. archive 時に恒久タグへ付け替える | `@spec:<capability>` と `@SC-xxx` をテストへ追記する | 採用しない。テストコードの書き換えが archive に必要になり、seal 済みの E2E ルートを変えることになる |
| B. main spec にシナリオ ID を埋める | `#### Scenario: [SC-012] ...` | 採用しない。OpenSpec の形式から外れ、MODIFIED の見出し一致にも影響する |
| C. archive 済み test-plan を集める | TP 行と対象外行を名前で main spec に結び付ける | 採用する |

C ならテストと archive の内容を変えずに導入できる。既存の archive にもそのまま使える。弱点はシナリオ名の変更に弱いことだが、名前が変われば「孤立」と「未保護」が同時に出るので、見逃しではなく要対応として現れる。

### 2. capability の特定には同じ change の delta spec を使う

test-plan の行には capability がない。同じ change の `specs/<capability-path>/spec.md` を読み、行のシナリオ名を含むファイルのパスを capability とする。同じ名前が複数の delta に現れる場合は、Requirement 列も一致するものに絞る。それでも一つに決まらない行は「対応不明」として表示し、保護には数えない。

### 3. 前後関係は archive フォルダ名で決める

archive フォルダは `YYYY-MM-DD-<id>` で、OpenSpec はこの順に main spec へ反映する。同じ日付の場合は名前の辞書順にする。git の履歴は使わない。shallow clone や rebase で変わるためである。

各 Requirement について、最後に ADDED または MODIFIED した change を「最新定義の change」とする。シナリオに対応する TP の change がそれより古ければ要再確認とする。最新定義の change 自身が TP または対象外行を持てば、その行を採用する。

### 4. 結果の照合は report.mjs の分類を共通化する

`report.mjs` の `flatten` と `STATUS_LABEL` を共通モジュールへ移し、reporter と coverage の両方から使う。flaky は reporter と同じく pass 扱いで、フレークの印を付ける。`add-flaky-management` で隔離の規則が入った場合は、同じ共通モジュールで揃える。

### 5. 出力と終了コード

既定は Markdown で、列は capability、Requirement、Scenario、分類、出所、結果。末尾に分類ごとの件数を出す。`--format json` は同じ内容を機械可読で出す（ジョブサマリーや他ツールとの連携用）。終了コードは 0（出力のみ）、1（`--strict` で要対応あり）、2（入力不正）。既存 reporter の 0/1/2/3 と意味が衝突しないよう、fail は単独のコードにせず `--strict` の 1 に含める。

### 6. CI は任意入力で追加する

`regression-command` は `e2e-command` と別にする。e2e-command は change の TP を確かめるもので、PR ごとに対象が変わる。回帰は全量で、対象 change がない PR でも走らせたい。出力先は既存の run ごとの report directory の下に `regression-results.json` として分ける。前の run の JSON を流用しないため、既存の鮮度検査を適用する。

## Risks / Trade-offs

- [シナリオ名の小さな表記揺れで対応が外れる] → 前後の空白だけ正規化し、それ以上の曖昧一致はしない。外れた行は「孤立」として表に出るので、test-plan の修正で直せる。
- [他層の宣言を実行確認なしに「保護」と表示する] → 分類名を「保護（他層の宣言）」と分け、集計の「実行で確認済み」には含めない。
- [archive が多いと読み込みが遅い] → 読むのは test-plan.md と delta spec だけにする。1,000 change 規模の fixture で所要時間を記録する。
- [旧 schema の取り込み範囲が曖昧] → 解析できる表だけを使い、それ以外は別欄に出す。保護に数えないので誤合格にはならない。

## Migration Plan

新しいサブコマンドと任意入力の追加だけなので、既存の利用者は何もしなくてよい。update 後に `node scripts/testkit-gate.mjs coverage` を実行すれば、既存の archive から対応表が出る。最初は「未保護」が多く出ることが想定されるため、docs に段階的な運用（まず表示だけ、次に `coverage-strict`）を書く。

## Open Questions

- 「保護率」の分母に他層の宣言を含めるか。表示上は分けて両方出すため、実装と仕様には影響しない。
