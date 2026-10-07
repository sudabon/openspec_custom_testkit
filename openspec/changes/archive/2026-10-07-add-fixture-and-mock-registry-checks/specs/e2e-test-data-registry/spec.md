# Spec Delta

## Purpose

E2E が前提とするテストデータとモックを登録表で説明可能にし、TP からの参照と、モックが実サービスの契約と最近照合されたことを検査する。QA が前提データやモックの妥当性を手作業で再確認する必要を減らす。

## ADDED Requirements

### Requirement: Fixture references are registered
統合 schema で `e2e: required` の change について、plan gate は各 TP の `Fixture` 列を `,` または `、` で区切った各要素を検査しなければならない（SHALL）。`mock:` で始まらない要素は fixture 名とし、E2E ルート配下の `fixtures/README.md` の登録表に同じ名前（バッククォートを除く）の行があり、その行の「使用する TP-ID」に `<change-id>:TP-NNN` が含まれなければならない（MUST）。要素が `なし` だけの場合は前提状態を持たない TP として登録検査を行わない。

#### Scenario: Unregistered fixture
- **WHEN** TP-002 の `Fixture` 列に `seed:cart-empty` があり、fixtures README にその行がない
- **THEN** plan gate は change id、TP-ID、fixture 名を示して失敗する

#### Scenario: Fixture row does not list the TP
- **WHEN** `seed:user-with-one-order` は登録済みだが、「使用する TP-ID」に `add-checkout:TP-002` がない
- **THEN** plan gate は失敗し、登録行への追記を案内する

#### Scenario: Bare TP identifier in the registry
- **WHEN** 登録行の「使用する TP-ID」が `TP-002` だけで change id を含まない
- **THEN** 統合 change の参照として数えず、plan gate は失敗する

#### Scenario: TP without preconditions
- **WHEN** TP の `Fixture` 列が `なし` である
- **THEN** 登録検査を行わず、その TP は fixture 未登録として失敗しない

### Requirement: Registry absence and legacy schemas
E2E ルートに `fixtures/README.md` が無い導入先で、統合 change の TP が fixture 名を参照する場合、plan gate は失敗し、README の作成を案内しなければならない（MUST）。旧 `spec-driven-e2e` の change では同じ不整合を警告として表示し、終了コードを変えてはならない（MUST NOT）。旧 `quality-driven` と `e2e: not-applicable` の change には登録検査を適用しない。

#### Scenario: Registry file is missing
- **WHEN** 統合 change の TP が `seed:admin` を参照し、E2E ルートに `fixtures/README.md` がない
- **THEN** plan gate は README のパスを示して失敗する

#### Scenario: Legacy E2E change with an unregistered fixture
- **WHEN** 旧 `spec-driven-e2e` の change の `前提(fixture)` 列に未登録の名前がある
- **THEN** 警告を表示し、plan gate の終了コードは登録検査の導入前と同じになる

### Requirement: Mock registration
外部サービスのモックを使う TP は、`Fixture` 列に `mock:<name>` を書かなければならない（MUST）。plan gate は E2E ルート配下の `mocks/README.md` の登録表に `<name>` の行があることを検査し、その行のモック名、対象サービス、契約の出典、整合の確認方法、最終確認日（YYYY-MM-DD）が空でないことを検査しなければならない（SHALL）。

#### Scenario: Mock is not registered
- **WHEN** TP の `Fixture` 列に `mock:payment-gateway` があり、mocks README にその行がない
- **THEN** plan gate は失敗する

#### Scenario: Mock row lacks a contract source
- **WHEN** `payment-gateway` は登録済みだが、契約の出典が空である
- **THEN** plan gate は欠けている列名を示して失敗する

#### Scenario: Malformed verification date
- **WHEN** 最終確認日が `2026/10/01` や将来日付である
- **THEN** plan gate は日付の形式または値が不正であるとして失敗する

### Requirement: Mock contract freshness at final
final gate は、対象 change の TP が使用する各モックの最終確認日から検査実行日までの日数が、`openspec/quality-policy.md` の `mock_contract_max_age_days` 以下であることを検査しなければならない（SHALL）。policy にこの値が無い場合は 90 日を使う。超過したモックがある場合、evidence の `residuals` に該当モック名を含む人間承認済みの Residual が無ければ失敗しなければならない（MUST）。

#### Scenario: Stale mock contract
- **WHEN** 使用モックの最終確認日が 120 日前で、policy の値が 90 である
- **THEN** final gate はモック名と経過日数を示して失敗する

#### Scenario: Stale mock accepted as residual
- **WHEN** 最終確認日が超過しているが、そのモック名を含み人間の承認者と日付が記入された Residual が evidence にある
- **THEN** final gate は鮮度の超過を理由に失敗しない

### Requirement: Optional contract test execution
CI は任意入力 `contract-command` を受け付けなければならない（SHALL）。指定された場合だけ実行し、command、終了コード、開始時刻を run 記録に残し、非ゼロ終了なら job を失敗させなければならない（MUST）。未指定の場合、kit は外部サービスへの送信を一切行ってはならない（MUST NOT）。`contract-command` の成功は最終確認日を自動で更新してはならない（MUST NOT）。

#### Scenario: Contract command is not configured
- **WHEN** `contract-command` が空である
- **THEN** 契約テストは実行されず、外部への通信も発生せず、鮮度検査は登録表の最終確認日だけで行われる

#### Scenario: Contract command fails
- **WHEN** `contract-command` が非ゼロで終了する
- **THEN** 結果を保存した後に job は失敗する

### Requirement: Fixture idempotency is a review obligation
kit は fixture の冪等性とテスト間の状態非共有を機械的に保証しないことを、E2E 規約と workflow 文書に明記しなければならない（MUST）。medium 以上の Human Code Review の確認項目に、fixture が各テストの前に状態を作り直すこと、テスト間で状態を共有しないことを含めなければならない（SHALL）。

#### Scenario: Reviewer checks fixture behavior
- **WHEN** medium の change で新しい fixture が追加される
- **THEN** 規約と review の確認項目に冪等性と状態非共有が示されており、gate の成功だけで冪等性が保証されたとは表示されない
