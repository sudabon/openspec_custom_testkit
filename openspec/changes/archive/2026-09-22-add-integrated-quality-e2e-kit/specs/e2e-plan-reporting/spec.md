# Spec Delta

## Purpose

仕様シナリオとE2Eの実施範囲を明示し、changeとTP-IDの組に対して実行結果を照合する。別changeの結果や古いレポート、skipだけの実行を成功と誤認せず、既存の呼出し形式と結果コードを維持する。

## ADDED Requirements

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

