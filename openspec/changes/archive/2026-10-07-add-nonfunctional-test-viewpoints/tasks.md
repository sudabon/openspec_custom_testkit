# Tasks

本リストは kit 自体を `spec-driven` で実装するためのタスクである。各タスクは対応する失敗 fixture を先に用意して RED を確認し、外から観測できる振る舞いを GREEN にする。未実行の検証はチェックしない。

## 1. テンプレートと instruction

- [x] 1.1 `quality-driven-e2e/templates/quality.md` に `## Non-functional Viewpoints` 表（観点 / Failure Mode / 該当なし理由）を6観点の固定行で追加する。完了条件: テンプレートから作った quality が既存の Risk / Oracle 解析を壊さないことを `test/contract.test.mjs` で確認する。
- [x] 1.2 `schema.yaml` の quality instruction に6観点と記入規則（`e2e: required` は6行必須、not-applicable は「全観点」1行を許可、理由必須）を追加する。完了条件: `openspec schema validate` と既存の schema 契約テストが通る。
- [x] 1.3 test-plan テンプレートと instruction に任意の `Projects` 列を追加する。完了条件: 列なし・列ありの両 fixture が既存 `checkTestPlan` で解析できる。

## 2. 計画ゲート

- [x] 2.1 `plan-check.mjs` に観点表の検査を追加する。完了条件: 欠落行、未知の F-ID、理由なし「該当なし」、F-ID と理由の両方記入、`e2e: required` での「全観点」1行の各負例が失敗し、正例が通るテストがある。
- [x] 2.2 stamp に `features.nonfunctionalViewpoints.since` を記録し、update で保持する。完了条件: 初回配置で日付が入り、同一内容の再実行で stamp が変わらず、旧 stamp からの update で既存項目が保持されることを `test/distribution.test.mjs` で確認する。
- [x] 2.3 導入日より前の change を警告に、`created` 欠落・不正、stamp の日付欠落、導入日以降の表欠落を失敗にする。完了条件: 4ケースの fixture で警告と失敗が区別される。旧 `quality-driven` / `spec-driven-e2e` change には表を要求しない。
- [x] 2.4 `Projects` の空要素を不正とし、重複を1つにまとめる。完了条件: `chromium, , chromium` の fixture が失敗し、`chromium, chromium` が1 project として扱われる。

## 3. reporter の project 照合

- [x] 3.1 `report.mjs` で TP ごとに pass した project 集合を作り、宣言集合と照合する。完了条件: 1 project 未実行で終了コード 1、1 project の fail で 3、両方あれば 3、全 project pass で 0 となる fixture テストがある。
- [x] 3.2 列なし plan の互換を確認する。完了条件: 既存 reporter の互換テスト（終了コード、flaky 表示、時刻表示）が無変更で通る。
- [x] 3.3 欠落表示に不足 project 名を出す。完了条件: 出力に `TP-002 (mobile-safari 未実行)` のように TP と project が表示される。

## 4. 規約と設定例

- [x] 4.1 `playwright.config.example.ts` に chromium / webkit / モバイル端末の projects 例を追加する。完了条件: smoke で example を使った Playwright 実行が通り、既存の実設定がある target では install が上書きしないことを確認する。
- [x] 4.2 `e2e-conventions` SKILL に `toHaveScreenshot`（mask、閾値緩和の禁止、baseline 作成環境）と `@axe-core/playwright`（違反0件、除外理由）の規約を追加する。完了条件: 規約の例にタグ `@<change-id>` と `@TP-NNN` があり、install が導入先の `package.json` を変更しないことをテストで確認する。

## 5. ドキュメントと全体検証

- [x] 5.1 `docs/workflow.md` と `docs/migration.md` に観点表、`e2e` による UI 判定の限界、導入日による旧 change の扱い、`Projects` 列の使い方を書く。完了条件: 文書レビューで spec の全 Scenario に対応する説明がある。
- [x] 5.2 全体を検証する。完了条件: `npm test`、`npm run lint`、`npm run test:smoke`、`openspec validate add-nonfunctional-test-viewpoints --strict` の実行結果を記録し、すべて成功している。
