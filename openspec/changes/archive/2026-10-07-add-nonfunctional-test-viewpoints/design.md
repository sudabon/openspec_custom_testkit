# Design

## Context

目的は proposal.md の Why を参照する。現在の quality テンプレートでは、Failure Modes の「観点」列は自由記述で、quality instruction の観点リストは境界値・null・エラー・冪等性・状態遷移・認可・後方互換だけである。`plan-check.mjs` は Risk / Oracle の参照と全シナリオの割当を検査するが、観点の網羅は検査しない。`report.mjs` は project 名を表示に使うだけで、coverage はいずれかの project の pass で成立する。`playwright.config.example.ts` は project を定義していない。

## Goals / Non-Goals

**Goals:**

- 6つの非機能観点を、割当か理由付きの対象外として必ず記録させ、計画ゲートで欠落を拒否する。
- 「どのブラウザ・端末で確認したか」を TP 単位で宣言し、結果 JSON と照合する。
- 既存の plan、旧 schema、進行中 change を壊さない。

**Non-Goals:**

- 観点の内容が妥当かの自動判定。妥当性は quality の人間承認で見る。
- 負荷試験基盤、セキュリティスキャナ、スクリーンショットのベースライン保管方式の提供。
- Test Layer の追加（`Manual` 層は `add-qa-handoff` の範囲）。

## Decisions

### 1. 観点は Failure Modes の列ではなく独立した表にする

既存の「観点」列に必須語を書かせる案は採用しない。1つの Failure Mode が複数観点を持つ場合や、どの Failure Mode にも当たらない「該当なし」を表現できず、自由記述の解析も不安定になるためである。`## Non-functional Viewpoints` 表（列: 観点 / Failure Mode / 該当なし理由）を追加し、観点名はテンプレートに固定した6語で照合する。Failure Mode 列はカンマ区切りの複数 ID を許す。Failure Mode と理由の両方が空の行は失敗、両方がある行も矛盾として失敗とする。

### 2. 「UI に触れる」は test-plan の `e2e` で代用する

差分のファイル拡張子やディレクトリから UI 変更を推定する案は、プロジェクト構成に依存し誤判定が避けられないため採用しない。quality に UI フラグを足す案も、quality に適用フラグを置かない既存方針（`e2e` は test-plan だけが持つ）と矛盾する。

統合 schema では、E2E が必要な change は利用者から見える振る舞いを持つとみなし、`e2e: required` なら6行すべてを要求する。`not-applicable` なら6行か、観点を「全観点」とした1行の「該当なし(理由)」を許す。UI に触れるのに `not-applicable` とする誤りは、quality の層選択と test-plan の整合検査（既存）と人間承認で検出する。この代用の限界を docs/workflow.md に書く。

### 3. 旧 change の扱いは stamp に記録した導入日で判定する

表の無い change をすべて失敗にすると、kit の update だけで進行中 change の CI が壊れる。逆に表が無ければ常に許すと、新しい change で省略できてしまう。

install / update が本機能を初めて配置したとき、stamp に `features.nonfunctionalViewpoints.since`（YYYY-MM-DD）を書き、以後の update では保持する。計画ゲートは、表の無い統合 change の `.openspec.yaml` の `created` がこの日付より前なら警告、それ以外は失敗とする。`created` が無い・不正、または stamp に日付が無いときは fail closed で失敗とする。stamp の既存項目と冪等性（同一内容の再実行で stamp を変えない）は維持する。

### 4. `Projects` 列は任意で、値がある TP だけ厳密に照合する

全 TP に project 指定を必須にする案は、単一ブラウザで十分なプロジェクトに不要な記入を強いるため採用しない。`report.mjs` の `flatten` は既に `projectName` を行に持つので、TP ごとに「pass した project の集合」を作り、宣言集合を包含するかで判定する。宣言にあるが結果に1行も無い project は未実行として欠落（終了コード 1）、いずれかの project で fail があれば失敗（終了コード 3）とし、既存の優先順位（失敗 3 が欠落 1 より優先）を保つ。`plan-check.mjs` は空要素を不正とし、project 名が Playwright 設定に存在するかは検査しない（動的設定を静的に解決できないため）。

### 5. 自動化の規約と設定例は依存を強制しない

`playwright.config.example.ts` に `projects`（`Desktop Chrome`、`Desktop Safari`、`iPhone 13` 等の `devices` プリセット）を追加する。example の位置づけは変えず、既存の実設定は上書きしない（既存の保護ファイル処理を使う）。`e2e-conventions` SKILL には次を追加する。

- 見た目の回帰: `await expect(page).toHaveScreenshot()` を使い、動的領域は `mask` で隠す。閾値（`maxDiffPixelRatio` 等）を緩めることはアサーション緩和として扱い、test-plan の更新と人間承認なしに行わない。
- アクセシビリティ: `@axe-core/playwright` の `AxeBuilder` で解析し、違反 0 件を期待値にする。除外ルールはテストに理由を書く。
- どちらも TP タグの規約は既存と同じにする。

`@axe-core/playwright` が無い導入先には install 時に何もせず、SKILL に導入コマンドを案内として書く。

## Risks / Trade-offs

- [`e2e` による UI 判定の誤り] → `not-applicable` の誤用は既存の層整合検査と人間承認に依存する。docs に限界を明記する。
- [6観点の記入が形骸化し「該当なし」が乱用される] → 理由を必須にし、quality 承認者が確認する。乱用の自動検出はしない。
- [スクリーンショット比較の環境差によるフレーク] → OS・フォントで差が出るため、CI と同じコンテナで baseline を作ることを SKILL に書く。フレーク集計は `add-flaky-management` に委ねる。
- [project 指定でCI時間が増える] → `Projects` を必要な TP だけに付ける運用を docs に書く。

## Migration Plan

1. update で新テンプレートと stamp の導入日を配置する。既存 change はテンプレートを再生成しない。
2. 導入日より前の change は警告のみ。新規 change から表を必須にする。
3. ロールバックは kit の旧版で update する。stamp の `features` 項目は旧版では無視される。

## Open Questions

- 6観点の名称（日本語表記）をプロジェクトの policy で追加・改名できるようにするか。今回は固定とし、拡張は別 change で扱う。
