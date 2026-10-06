# Tasks

本リストは kit 自体を既存 `spec-driven` で実装するためのタスクである。各実装タスクは対応する失敗 fixture を先に用意し、外から観測できる振る舞いを GREEN にする。未実行の検証はチェックしない。

## 1. fixture と共通化

- [x] 1.1 main spec と archive 済み change の組を持つ fixture repo を作る。保護（E2E）、他層の宣言、未保護、同名シナリオ、要再確認、新 TP 付きの MODIFIED、REMOVED、RENAMED、未 archive の change、旧 schema の表と本文だけの例を含める。完了条件: spec の各 Scenario に対応する fixture が 1 つ以上あり、期待する分類を表にして test に置いている。
- [x] 1.2 `report.mjs` の結果平坦化と状態分類を共通モジュールへ移す。完了条件: 既存の reporter テストが変更なしで GREEN のまま、正常入力の終了コード 0/1/2/3 と flaky 表示が変わらない。不正 JSON（suites 欠落・トップレベル errors を含む）は終了コード 2 として検証する。

## 2. 対応表の組み立て

- [x] 2.1 main spec の全 capability・Requirement・Scenario を列挙する処理を実装する。完了条件: 入れ子の capability パスと 0 件の場合を含む fixture で、列挙結果が期待表と一致する。
- [x] 2.2 archive 済み change の test-plan 行を、同じ change の delta spec から capability に結び付ける処理を実装する。完了条件: 同名シナリオの fixture で一方の capability だけが保護になり、決まらない行は対応不明になる。
- [x] 2.3 archive フォルダ順で Requirement の最新定義 change を求め、要再確認と孤立を分類する。完了条件: MODIFIED（新 TP あり・なし）、REMOVED、RENAMED の各 fixture が期待どおりに分類され、要再確認と孤立は保護に数えない。
- [x] 2.4 旧 `spec-driven-e2e` の表を取り込み、本文だけの TP-ID を「旧形式・対応不明」に分ける。旧 `quality-driven` の test-plan は読まず、delta は要再確認・孤立の判定に使う。完了条件: 旧形式の両 fixture で、表の行だけが保護になる。

## 3. 結果の照合とコマンド

- [x] 3.1 Playwright JSON を共通モジュールで読み、change id と TP-ID の完全一致で結果を添える。完了条件: fail、未実行、別 change の同 TP-ID、flaky の fixture で期待どおりの結果欄になり、fail と未実行は「実行で確認済み」に入らない。
- [x] 3.2 `testkit-gate.mjs coverage` に `--results`、`--max-age`、`--strict`、`--format` を実装する。完了条件: 既定 0、strict で要対応ありは 1、欠落・不正・古い JSON は 2 になる CLI テストが通り、既存サブコマンドのテストは変更なしで GREEN。
- [x] 3.3 Markdown と JSON の出力形式を固定する。完了条件: golden file で列・集計・0 件時の表示を確認し、0 件で保護率 100% を出さない。

## 4. CI と配布

- [x] 4.1 再利用可能 workflow と `ci-job.mjs` に `regression-command` と `coverage-strict` を追加する。完了条件: local harness で、change 差分なしでも回帰が走ること、未指定時は既存の手順と出力が同じであること、回帰失敗が対応表の保存後も job 失敗になることを確認できる。
- [x] 4.2 新しい lib をインストーラの配布対象と doctor の必須 module に加える。完了条件: pack した成果物からの install と update で配置され、旧版のままなら doctor が incomplete になる。

## 5. 文書と検証

- [x] 5.1 `docs/workflow.md` と README に対応表の読み方、分類の意味、段階的な導入手順を書く。完了条件: 文書のコマンド例を fixture repo で実行し、記載どおりの出力になる。
- [x] 5.2 1,000 change 規模の合成 fixture で所要時間を測り、`docs/verification-log.md` に記録する。完了条件: 測定コマンドと結果が記録され、未計測の項目を計測済みと書いていない。
- [x] 5.3 `npm test`、`npm run lint`、`npm run test:smoke` を実行する。完了条件: すべて成功し、結果を verification-log に記録している。
