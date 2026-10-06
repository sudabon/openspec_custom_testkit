# Spec Delta

## Purpose

main spec の全シナリオが、どの E2E テストまたは他層の代替検証で守られているかを一覧にする。保護されていないシナリオ、仕様変更で古くなった対応、削除済み仕様を指すテストを区別して示し、QA が手動回帰テストを減らす判断の根拠にする。

## ADDED Requirements

### Requirement: Scenario coverage map across main specs
システムは `openspec/specs` 配下の全 capability の全 `#### Scenario:` を、capability のパスとシナリオ名の組をキーとして列挙しなければならない（SHALL）。各シナリオには、archive 済み change の test-plan.md から対応する行を集めて割り当てなければならない（SHALL）。TP 行は E2E 保護、`## 対象外シナリオ` 行は Layer と Method を伴う他層の宣言として扱わなければならない（SHALL）。test-plan の行がどの capability に属するかは、同じ change の delta spec でそのシナリオを含むファイルのパスから決めなければならない（SHALL）。テストのタグを付け替えてはならない（MUST NOT）。

#### Scenario: Scenario protected by an archived TP
- **WHEN** main spec にあるシナリオが、archive 済み change の test-plan の TP 行で割り当てられている
- **THEN** 対応表はそのシナリオを「保護（E2E）」とし、change id と TP-ID を表示する

#### Scenario: Scenario delegated to another layer
- **WHEN** main spec にあるシナリオが、archive 済み change の `## 対象外シナリオ` 行だけで割り当てられている
- **THEN** 対応表はそのシナリオを「保護（他層の宣言）」とし、Oracle、Layer、Method を表示する
- **AND** 実行結果を照合していない宣言であることを表示する

#### Scenario: Scenario without any mapping
- **WHEN** main spec にあるシナリオが、どの archive 済み change の test-plan にも割り当てられていない
- **THEN** 対応表はそのシナリオを「未保護」とする

#### Scenario: Same scenario name in two capabilities
- **WHEN** 同じシナリオ名が二つの capability に存在し、test-plan の行は一方の capability の delta spec にだけ対応する
- **THEN** 対応表はその行を delta spec が属する capability にだけ割り当て、もう一方を保護に数えない

#### Scenario: Active change is not protection
- **WHEN** 未 archive の change の test-plan だけがシナリオを割り当てている
- **THEN** 対応表はそのシナリオを保護に数えず、進行中の change があることを補足として表示する

### Requirement: Stale and orphaned coverage detection
システムは、対応する TP より後に archive された change の delta spec で、そのシナリオを含む Requirement が MODIFIED されている場合、その対応を「要再確認」と分類しなければならない（SHALL）。前後関係は archive フォルダの日付と名前の順で決めなければならない（SHALL）。より新しい change が同じシナリオへ TP を割り当てていれば、古い対応では要再確認にしてはならない（MUST NOT）。main spec に存在しないシナリオを指す TP は「孤立」と分類しなければならない（SHALL）。要再確認と孤立を保護に数えてはならない（MUST NOT）。

#### Scenario: Requirement modified after the TP was written
- **WHEN** change A の TP がシナリオ S を守り、その後に archive された change B が S を含む Requirement を MODIFIED し、B の test-plan は S に TP を割り当てていない
- **THEN** 対応表は S を「要再確認」とし、A の TP-ID と B の change id を表示する

#### Scenario: Requirement modified with a new TP
- **WHEN** change B が Requirement を MODIFIED し、同じ change の TP でシナリオ S を割り当てている
- **THEN** 対応表は S を B の TP による「保護（E2E）」とし、A の古い TP を要再確認にしない

#### Scenario: Scenario removed or renamed
- **WHEN** archive 済み change の TP が指すシナリオが、後の REMOVED または RENAMED によって main spec に存在しない
- **THEN** 対応表はその TP を「孤立」として、テストの削除または付け替えの検討対象に表示する

### Requirement: Execution results joined to the coverage map
システムは、Playwright の JSON 結果を任意で受け取り、E2E 保護の各行に結果を添えなければならない（SHALL）。照合は change id と TP-ID の両方のトークン完全一致で行い、既存の E2E レポータと同じ状態分類を使わなければならない（SHALL）。実 attempt のない行は「未実行」としなければならない（SHALL）。失敗または未実行の行を保護済みとして集計してはならない（MUST NOT）。結果を渡さない場合は、結果欄を空にして宣言上の対応だけを表示しなければならない（SHALL）。

#### Scenario: Full regression run is provided
- **WHEN** 全量実行の JSON を渡し、保護（E2E）の TP の一つが fail、一つが実行されていない
- **THEN** 対応表は前者を fail、後者を未実行と表示し、集計の「実行で確認済み」に含めない

#### Scenario: Results include another change with the same TP-ID
- **WHEN** JSON に別 change の同じ TP-ID のテストだけがある
- **THEN** 対応表はその結果を対象の TP に流用せず、未実行と表示する

#### Scenario: Stale or malformed results
- **WHEN** JSON が欠落・不正、または `--max-age` を超えている
- **THEN** コマンドは終了コード 2 で止まり、宣言上の対応表を成功として出力しない

### Requirement: Coverage command interface and exit codes
システムは `testkit-gate.mjs coverage [--results <path>] [--max-age <秒>] [--strict] [--format markdown|json]` を提供しなければならない（SHALL）。既定では分類結果を出力して終了コード 0 で終わらなければならない（SHALL）。`--strict` のとき、未保護、要再確認、孤立、fail、未実行のいずれかがあれば終了コード 1 で終わらなければならない（SHALL）。入力の欠落・破損・鮮度違反は終了コード 2 としなければならない（SHALL）。既存の `doctor`、`select`、`check` の引数と終了コードを変えてはならない（MUST NOT）。

#### Scenario: Default report
- **WHEN** 未保護のシナリオがあり `--strict` を付けずに実行する
- **THEN** 表と集計を出力し、終了コード 0 で終わる

#### Scenario: Strict mode in CI
- **WHEN** `--strict` を付け、要再確認が 1 件ある
- **THEN** 終了コード 1 で終わり、該当シナリオを出力に含める

#### Scenario: Main specs are empty
- **WHEN** `openspec/specs` にシナリオが 1 件もない
- **THEN** 0 件であることを明示して出力し、保護率を 100% と表示しない

### Requirement: Legacy test plans are mapped conservatively
システムは旧 `spec-driven-e2e` の archive 済み change から、TP-ID、Requirement、シナリオ名の表として解析できる行だけを対応に使わなければならない（SHALL）。シナリオと結び付けられない TP-ID は「旧形式・対応不明」として別欄に表示し、保護に数えてはならない（MUST NOT）。旧 `quality-driven` の change は test-plan を持たないため、対応の入力にしてはならない（MUST NOT）。

#### Scenario: Legacy plan with a parsable table
- **WHEN** 旧 schema の test-plan に TP-ID とシナリオ名の列を持つ表がある
- **THEN** その行は統合 schema の TP 行と同じ規則で割り当てられる

#### Scenario: Legacy plan with free text only
- **WHEN** 旧 schema の test-plan に TP-ID が本文中にしか現れない
- **THEN** その TP-ID は「旧形式・対応不明」に表示され、どのシナリオの保護にも数えない

### Requirement: Optional regression run in the reusable workflow
再利用可能 workflow は任意入力 `regression-command` と `coverage-strict` を受け付けなければならない（SHALL）。`regression-command` が指定されたとき、change の有無にかかわらず実行し、その結果 JSON を固有の出力先へ保存して coverage コマンドに渡さなければならない（SHALL）。`coverage-strict` が真のときだけ coverage の終了コード 1 を job の失敗にしなければならない（SHALL）。未指定時は既存の job の挙動と出力を変えてはならない（MUST NOT）。回帰コマンドの失敗は、coverage の出力を保存した後でも job の失敗として伝えなければならない（SHALL）。

#### Scenario: Implementation-only pull request with regression command
- **WHEN** `openspec/changes` に差分がない PR で `regression-command` が指定されている
- **THEN** 回帰コマンドが実行され、対応表が job の出力として保存される

#### Scenario: Regression command is not configured
- **WHEN** `regression-command` が空である
- **THEN** workflow は既存と同じ手順と終了コードで完了する

#### Scenario: Regression run fails
- **WHEN** 回帰コマンドが非ゼロで終わる
- **THEN** 対応表を保存したうえで job は失敗する
