# Spec Delta

## Purpose

Risk と Oracle の品質契約に基づき、実装前の承認・sealと実行後の反証・証跡を検査する。計画ファイルの存在だけで品質保証済みとせず、archive時にも同じ根拠を検証して不完全な完了判定を防ぐ。

## ADDED Requirements

### Requirement: Approval and risk validation

QEゲートは tasks があるのに quality がない、Riskが不正、risk_levelが全Riskの最大値でない、未承認でタスク完了がある状態を MUST 拒否する。統合版の承認は空でないapproved_byと有効なapproved_atを必要とする。

#### Scenario: Missing quality or approval

- **WHEN** qualityなしでtasksを作る、または承認未完了で任意タスクを完了する
- **THEN** 原因を示して失敗し、計画が存在するだけの未承認・全タスク未完了状態とは区別する

#### Scenario: Risk understatement

- **WHEN** Risk Registerにhighがあるのにrisk_levelがlowである
- **THEN** 最大Riskとの不一致を検出し、低い基準で検査を継続しない

### Requirement: Sealed oracle integrity

統合版は全Riskで番号2以降の実装タスク完了より先に人間のsealを MUST 要求する。sealは空でないOracleファイル集合のパスと内容に結び付き、変更・追加・削除・リネームを検出する。空ディレクトリまたは欠落集合を有効なsealとしてはならない。

#### Scenario: Low implementation precedes seal

- **WHEN** lowの統合changeでseal前に実装タスクを完了する
- **THEN** medium/highと同じく失敗する

#### Scenario: Oracle set changes after seal

- **WHEN** seal後に内容変更、ファイル追加、削除、リネームのいずれかが発生する
- **THEN** digest不一致または欠落として失敗し、変更理由・人間再承認・再sealを要求する

#### Scenario: Empty oracle set

- **WHEN** oracle_pathsが空、空ディレクトリだけ、または存在しない
- **THEN** seal操作は失敗し、完了時にもOracle検証済みと認めない

### Requirement: Falsification and mutation evidence

統合版の完了判定は全Riskで独立反証の実施記録を MUST 必要とし、発見した反例の修正または人間承認済みResidual Riskを要求する。highではMutationコマンド・実行結果・適用閾値を必要とし、70%の初期閾値未満を成功にしてはならない。

#### Scenario: Low falsification is absent

- **WHEN** lowの統合changeを独立反証の記録なしで完了させる
- **THEN** 必須証跡欠落として失敗する

#### Scenario: High mutation is absent or insufficient

- **WHEN** highでMutationコマンド未指定、結果なし、閾値未達のいずれかがある
- **THEN** 非ゼロ終了し、他のテスト成功で代用しない

#### Scenario: Counterexample is retained

- **WHEN** 反証で見つかった反例を修正しない
- **THEN** 理由と残留影響、人間の受容記録がなければ完了を拒否する

### Requirement: Structured execution evidence

統合evidenceは全Riskについて Failure Mode、Oracle、テスト層、該当時TP-ID、結果、コマンド、時刻、対象revision、結果取得元を MUST 対応付ける。IDが文中にあるだけでは合格せず、構造検査と実際の実行結果検証を区別して表示する。

#### Scenario: Identifiers without results

- **WHEN** evidenceにR1やO1の文字だけを書き、結果または取得元を省く
- **THEN** 構造不足として失敗し、実行済みと判断しない

#### Scenario: E2E is not applicable

- **WHEN** test-planが理由付きnot-applicableである
- **THEN** 代替層のOracle実行結果を必要とし、E2E不要を検証全体の免除にしない

#### Scenario: Oracle was resealed

- **WHEN** seal済みOracleを人間確認のうえ変更する
- **THEN** 変更理由・再承認・再sealの記録と現在digestを照合し、履歴欠落を診断する

### Requirement: Archive finalization checks

archiveの統合最終検査は quality、妥当なRisk、承認、seal、全タスク完了、独立反証、必要なMutation・review、全Riskの証跡を MUST 再検証する。旧形式には新規列や成果物を要求せず、既存契約の検査を維持する。

#### Scenario: Archive with incomplete evidence

- **WHEN** 未完了tasks、quality欠落、承認・seal不足、不正Risk、未対応Riskのいずれかを含めarchiveへ移動する
- **THEN** 最終検査が失敗し、移動済みという理由で検査をskipしない

