# Proposal

## Why

統合 schema `quality-driven-e2e` は Risk から Oracle・E2E・反証・証跡までを追跡するが、その結果を QA エンジニアへ渡す成果物がない。Residual Risk は「Green が保証しないこと」を書く欄であり、QA が次に何を確認すればよいかの形になっていない。そのため QA は自動化済みの範囲も含めて全体を手で確認し直すことになり、工数が減らない。QA の作業を「全部テストする」から「自動化されていない残りだけを見る」に変えるため、引き継ぎ成果物と、その欠落を検出するゲートを追加する。

## What Changes

- `quality-driven-e2e` の Test Layer Mapping に `Manual` 層（探索テストを含む）を追加する。Manual を選ぶ Failure Mode には、自動化しない理由を必須にする。
- 新しいテンプレート `qa-handoff.md` を配布する。evidence と同じく apply の依存にはせず、tasks の最終グループで作る。中身は次の4つ。
  - 自動化済みで QA が見なくてよい範囲（evidence の `risk_results` から作る）
  - Manual 層の Failure Mode と Residual Risk に基づく確認範囲
  - 探索テストのチャーター（目的・対象・時間の目安）
  - QA の実施結果欄（人間だけが記入する。Agent は記入しない）
- final gate は、Manual 層または Residual がある change について、次の場合に失敗する。qa-handoff.md が無い、Manual 層の F-ID が載っていない、テンプレートの空欄が残っている。
- QA の実施結果欄は archive の段階で必須にする（理由は design.md）。
- 旧 `quality-driven` と `spec-driven-e2e` の change には適用しない。

## Capabilities

### New Capabilities

- `qa-handoff`: Manual 層の定義、QA 引き継ぎ成果物の構成、final と archive での検査、人間専用欄の扱い。

### Modified Capabilities

なし。`integrated-quality-workflow` には要件を ADDED で追加するだけで、既存の要件は変更しない。

## Impact

- 変更対象: `payload/openspec/schemas/quality-driven-e2e/schema.yaml`（quality と tasks の instruction）、`templates/quality.md`、新規 `templates/qa-handoff.md`、`payload/openspec/quality-policy.md`、`payload/scripts/lib/`（plan-check の層解析、新規 qa-handoff の検査、evaluate の final/archive 判定）、`test/`、`docs/workflow.md`。
- 関連する change:
  - `add-qa-role-and-effort-metrics`: QA の役割と工数指標。実施結果欄の記入者をその change の QA 役割に揃える。どちらかが先に archive されたら、後のほうの文言を合わせる。
  - `add-nonfunctional-test-viewpoints`: 層を増やさない方針。本 change の `Manual` 層とは独立している。非機能観点を自動化しないと判断したときの受け皿が `Manual` になる。
  - `add-regression-coverage-map`: 対応表は自動テストの範囲を扱う。Manual 層をどう表示するかはその change で決める。
  - `add-e2e-result-publishing`: 公開するサマリーに handoff へのリンクを含めることはできるが、本 change の必須事項にはしない。
- 互換性: Manual 層も Residual も無い change では handoff を要求しない。既存の統合 change が新しく失敗するのは、Residual がある場合だけ。その移行の案内を `docs/migration.md` に書く。
