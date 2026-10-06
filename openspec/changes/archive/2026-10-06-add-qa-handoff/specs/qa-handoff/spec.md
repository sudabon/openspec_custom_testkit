# Spec Delta

## Purpose

統合 schema の change ごとに、自動化で保証した範囲と QA が手で確認すべき残りの範囲を一つの引き継ぎ成果物として出し、その欠落や未記入をゲートで検出することで、QA が全体を再テストせずに済むようにする。

## ADDED Requirements

### Requirement: Manual layer requires a reason not to automate
統合 schema の quality.md の Test Layer Mapping は、`Static` / `Unit` / `Integration` / `E2E` / `Monitoring` に加えて `Manual` 層を受け付けなければならない（SHALL）。探索テストも `Manual` に含める。`Manual` を選んだ Failure Mode の行には、自動化しない理由を書かなければならない（MUST）。理由が空なら計画ゲートは失敗しなければならない（MUST）。`Manual` は E2E 層とはみなさない。`Manual` しか無いことを理由に test-plan の `e2e` を required にしてはならない（MUST）。

#### Scenario: Manual layer without a reason
- **WHEN** Test Layer Mapping のある行が `Manual` を選び、選定理由の欄が空である
- **THEN** 計画ゲートはその Failure Mode の ID を示して失敗する

#### Scenario: Manual layer does not imply E2E
- **WHEN** quality.md の層が `Unit` と `Manual` だけで、test-plan が `e2e: not-applicable` である
- **THEN** 層の矛盾としては失敗しない

### Requirement: QA handoff artifact content
kit は統合 schema 用に `qa-handoff.md` テンプレートを提供しなければならない（SHALL）。このテンプレートは次の節を持つ。

- 自動化済み範囲
- 手動確認範囲
- 探索チャーター
- QA 実施結果

自動化済み範囲は evidence の `risk_results` のうち `result` が `pass` の Risk・Failure Mode・Oracle・TP-ID を列挙する。`pass` でない行を自動化済みとして載せてはならない（MUST）。手動確認範囲は、Manual 層のすべての Failure Mode と、quality.md と evidence の Residual のすべてを ID 付きで載せる。探索チャーターの各行は、目的・対象・時間の目安を持つ。qa-handoff.md は apply の必須 artifact にしてはならない（MUST NOT）。

#### Scenario: Automated scope comes from passing evidence
- **WHEN** evidence の `risk_results` に R1 が `pass`、R2 が `fail` と記録されている
- **THEN** 自動化済み範囲に R2 を載せた qa-handoff.md は final gate で失敗する

#### Scenario: Apply does not wait for the handoff
- **WHEN** tasks.md まで揃い、qa-handoff.md がまだ無い
- **THEN** apply は ready になる

### Requirement: Final gate enforces the handoff
統合 schema の change が final として検査されるとき、次のいずれかに当てはまれば、qa-handoff.md の存在と構造を必須にしなければならない（MUST）。

- Test Layer Mapping に `Manual` の行がある
- quality.md の Residual Risk に空でない項目がある
- evidence の `residuals` が空でない

final gate は次の場合に失敗しなければならない（MUST）。

- qa-handoff.md が無い
- Manual 層の F-ID または Residual の ID が手動確認範囲に載っていない
- 探索チャーターの行に目的・対象・時間の目安の空欄がある
- テンプレートの記入例が置き換えられずに残っている

どの条件にも当てはまらない change では、handoff を要求してはならない（MUST NOT）。

#### Scenario: Manual failure mode missing from the handoff
- **WHEN** quality.md で F3 が `Manual` 層であり、qa-handoff.md の手動確認範囲に F3 が無い
- **THEN** final gate は F3 を示して失敗する

#### Scenario: Unfilled template is not a handoff
- **WHEN** qa-handoff.md がテンプレートの記入例のまま残っている
- **THEN** final gate は未記入として失敗する

#### Scenario: Nothing left for manual testing
- **WHEN** Manual 層が無く、quality.md と evidence に Residual が無い
- **THEN** qa-handoff.md が無くても final gate は handoff を理由に失敗しない

### Requirement: QA result is human-only and required at archive
QA 実施結果欄（実施者・実施日・判定・所見）は人間だけが記入する（SHALL）。schema の instruction と role 定義は、Agent がこの欄を記入することを禁止しなければならない（MUST）。PR の final 検査では、この欄が空でも失敗させない。archive 済みとして検査される change では、実施者、`YYYY-MM-DD` 形式の実施日、`pass` または `fail` の判定が揃っていなければ失敗しなければならない（MUST）。判定が `fail` のときも失敗しなければならない（MUST）。kit は記入者の本人確認をしない。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存することを文書に書かなければならない（MUST）。

#### Scenario: Final check before QA has run
- **WHEN** 全タスクが完了して final 検査が走り、QA 実施結果欄が空である
- **THEN** 結果欄の欠落は警告として表示され、失敗にはならない

#### Scenario: Archive without a QA result
- **WHEN** handoff が必要な change が archive され、QA 実施結果の判定が空である
- **THEN** archive の検査は失敗する

#### Scenario: QA reports a failure
- **WHEN** archive された change の QA 判定が `fail` である
- **THEN** archive の検査は失敗し、所見を修正するか、Residual として承認し直すよう案内する

### Requirement: Legacy schemas do not require a handoff
旧 `quality-driven` と `spec-driven-e2e` の change には、Manual 層の理由も qa-handoff.md も要求してはならない（MUST NOT）。

#### Scenario: Legacy change with residual risk
- **WHEN** 旧 `quality-driven` の change に Residual Risk がある
- **THEN** handoff の欠落を理由に失敗しない
