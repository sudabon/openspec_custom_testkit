# Spec Delta

## Purpose

E2E のフレークを Risk に応じて合否へ反映し、壊れたテストを期限と代替検証つきで隔離できるようにする。リトライ後の成功や隔離中のテストを、自動で守られている範囲として誤って扱わない。

## ADDED Requirements

### Requirement: Policy-driven flaky strictness

統合 schema の reporter は、quality-policy の `flaky_fail_levels` に含まれる Level の Risk に紐づく TP が flaky のとき、その TP を不合格として扱い、終了コード 3 を MUST 返す。含まれない Level の TP の flaky は、成功として数えつつ警告を表示する。TP の Level は test-plan の Risk 列と quality.md の Risk Register から決める。

#### Scenario: High risk TP is flaky

- **WHEN** policy が `flaky_fail_levels: [high]` で、Level が high の Risk に紐づく TP のテストがリトライ後に成功する
- **THEN** pass と flaky を表示したうえで不合格の理由と Level を示し、終了コード 3 を返す

#### Scenario: Low risk TP is flaky

- **WHEN** 同じ policy で、Level が low の Risk に紐づく TP のテストがリトライ後に成功する
- **THEN** coverage に数え、警告を表示し、その TP を理由に失敗させない

#### Scenario: TP level cannot be resolved

- **WHEN** flaky になった TP の Risk が quality.md で Level に解決できない
- **THEN** その flaky を不合格として扱い、解決できない理由を表示する

#### Scenario: Invalid flaky policy value

- **WHEN** `flaky_fail_levels` に low / medium / high 以外の値がある
- **THEN** 方針を無視せず、入力エラーとして終了コード 2 を返す

### Requirement: Flaky defaults remain compatible

フレーク方針が policy に無い場合と、旧 schema の change では、reporter は既存の flaky の扱いを MUST 維持する。

#### Scenario: Policy without flaky settings

- **WHEN** policy に `flaky_fail_levels` が無く、TP のテストがリトライ後に成功する
- **THEN** 従来どおり pass として数えて flaky を表示し、終了コードを変えない

#### Scenario: Legacy E2E change

- **WHEN** `spec-driven-e2e` の change のテストが flaky になる
- **THEN** フレーク方針と隔離リストを適用せず、従来の終了コードを返す

### Requirement: Quarantine registry

E2E ルート直下の `quarantine.md` は、隔離する TP ごとに TP-ID、change、理由、担当、期限（YYYY-MM-DD）、代替（Oracle ID または Residual ID）を MUST 持つ。必須列が欠けた行、change が無い行、代替が無い行は、有効な隔離として扱ってはならない。

#### Scenario: Incomplete quarantine entry

- **WHEN** 隔離の行に担当、期限、代替のいずれかが無い
- **THEN** その TP を隔離中とせず、欠落として失敗させ、足りない列を表示する

#### Scenario: Same TP identifier in another change

- **WHEN** 隔離の行の change が対象 change と異なり、TP-ID だけが一致する
- **THEN** 対象 change の TP を隔離中として扱わない

### Requirement: Quarantined tests are not coverage

reporter は有効な隔離中の TP を coverage に MUST NOT 数えない。その TP は欠落とは区別して「隔離中」と表示し、件数を報告する。隔離中の TP のテストが実行されて成功しても coverage に数えない。

#### Scenario: Valid quarantine

- **WHEN** 期限内で必須列がそろった隔離の行がある TP のテストが実行されない
- **THEN** 欠落として失敗させず、隔離中として TP-ID・担当・期限・代替を表示する

#### Scenario: Quarantined test passes

- **WHEN** 隔離中の TP のテストが実行されて成功する
- **THEN** coverage に数えず、隔離中の表示を続け、解除はリストの変更で行うよう案内する

### Requirement: Quarantine expiry

reporter は、期限日を過ぎた隔離の行を MUST 失効として扱い、その TP を欠落として失敗させる。期限日の当日は有効とする。

#### Scenario: Expired quarantine

- **WHEN** 隔離の行の期限が実行日の前日以前である
- **THEN** 隔離中として扱わず、期限切れの TP と担当を表示して欠落の終了コードを返す

### Requirement: Quarantine alternative is evidenced at final

統合 schema の final ゲートは、隔離中の TP がある change について、代替が成立していることを MUST 確認する。代替が Oracle ID なら、その Oracle を含む pass の結果が evidence にあること。Residual ID なら、承認者と日付のある Residual が evidence にあること。

#### Scenario: Alternative oracle has no passing result

- **WHEN** 隔離の代替に指定した Oracle の pass の結果が evidence に無い
- **THEN** final ゲートを失敗させ、TP-ID と代替 Oracle を示す

#### Scenario: Residual is not approved

- **WHEN** 隔離の代替に指定した Residual に承認者または日付が無い
- **THEN** final ゲートを失敗させ、人間の承認が必要なことを示す
