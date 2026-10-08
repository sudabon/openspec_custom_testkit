# change-gate-selection Specification

## Purpose
QE と E2E が同じ change 集合とメタデータを基に検査を選択できるようにする。差分やarchive移動による検査漏れを防ぎ、正当な対象外とメタデータの欠落・破損を明確に区別する。

## Requirements

### Requirement: Common schema-aware gate selection

全ゲートと統合CIは共通の対象判定を MUST 使用する。統合schemaと、有効な互換宣言を持つその派生schemaはQEと適用されるE2E、quality-drivenはQE、spec-driven-e2eはE2E、無関係schemaは理由付き対象外とする。派生schemaのchangeは宣言上のschema名を保持したまま統合schemaの系統として判定し、統合schemaより弱い検査にしてはならない。旧changeへ新成果物や適用キーを遡及要求しない。

#### Scenario: Mixed schema pull request

- **WHEN** 統合、旧QE、旧E2E、無関係schemaのchangeが混在する
- **THEN** changeごとに必要な検査を選び、QE単独へE2Eを要求せず、他のchangeを対象外の巻き添えにしない

#### Scenario: Unrelated schema

- **WHEN** 明示的に無関係と判断できるschemaだけが変わる
- **THEN** 対象外理由を表示し、unknownやmissingと区別する

#### Scenario: Derived schema in a mixed pull request

- **WHEN** 統合schemaのchangeと、有効な互換宣言を持つ派生schemaのchangeが同じ差分にある
- **THEN** 両方を統合changeとして同じQEとE2Eの検査に選び、派生schemaのchangeを無関係schemaとして対象外にしない

### Requirement: Fail closed on ambiguous metadata

統合対象と判定されたchangeまたは判定不能なchangeのメタデータ欠落・破損を、既定schemaへの黙ったfallbackや対象外として MUST 扱わない。診断して非ゼロ終了する。旧kitの契約でconfigから解決できる旧changeのmetadata省略は互換範囲として認めるが、比較元が統合schemaのchangeには適用しない。明示されたchangeが存在しない場合も入力エラーとする。比較元で統合系統（統合schemaまたは有効な派生schema）だったchangeが、HEADで統合系統以外のschema（宣言の無い独自schema、spec-driven、quality-driven、spec-driven-e2e、無効な宣言のschema）を宣言している場合も、統合changeとして検査を続け、schemaの付け替えを診断して非ゼロ終了する（MUST）。統合系統どうしの付け替えは失敗にしない。この扱いを環境変数で外してはならない（MUST NOT）。

#### Scenario: Broken or removed schema declaration

- **WHEN** 統合changeの .openspec.yaml が不正または差分で削除される
- **THEN** 比較元の情報も使い、統合検査を外すことなく不足を報告する

#### Scenario: Integrated change switched to an unrelated schema

- **WHEN** 比較元で `quality-driven-e2e` のchangeの `.openspec.yaml` を、PRで宣言の無い `team-custom` に書き換える
- **THEN** ゲートはそのchangeを統合changeとして検査し、比較元とHEADのschema名を示して非ゼロ終了する

#### Scenario: Derived change switched to a legacy schema

- **WHEN** 比較元で有効な派生schema `quality-driven-e2e-mockup` のchangeを、PRで `quality-driven` に書き換える
- **THEN** ゲートは旧QEの扱いに落とさず統合changeとして検査し、非ゼロ終了する

#### Scenario: Switch within the integrated family

- **WHEN** 比較元で `quality-driven-e2e` のchangeを、PRで有効な派生schema `quality-driven-e2e-mockup` に書き換える
- **THEN** ゲートは付け替えを失敗にせず、統合changeとして通常どおり検査する

#### Scenario: Lint cannot be weakened through a downgrade

- **WHEN** 比較元で統合系統だったchangeのschemaを付け替え、`QE_E2E_LINT_MODE=warn` を指定して lint を実行する
- **THEN** タグ付きソースの違反は警告に落ちず、統合schemaと同じく強制される

### Requirement: Archive and deletion detection

対象判定は repo root 基準の比較元refとHEADの差分から追加・変更・移動・削除を MUST 扱う。archive移動は移動後の成果物で最終検査し、純削除は削除状態として報告し、完了・archive成功の証拠にしない。

#### Scenario: Archive rename

- **WHEN** active changeをarchiveへ移動する
- **THEN** 元change-idを保持して一度だけ最終検査し、移動によって承認・seal・証跡の不足を回避できない

#### Scenario: Deletion without archive

- **WHEN** changeをarchiveせず削除する
- **THEN** 削除対象と比較元schemaを表示し、統合の完了証跡としては非ゼロ判定する

### Requirement: Selection inputs remain compatible

既存の qe-gate check [--base ref] [change...]、check-test-plan.sh [base-ref] の呼出しを MUST 維持する。QE_SCHEMA の明示指定は旧互換対象の選択に適用できるが、統合changeの必須検査を除外する手段にしてはならない。

#### Scenario: Legacy schema override

- **WHEN** QE_SCHEMA=quality-drivenで統合と旧QEが混在する差分を検査する
- **THEN** 旧QEと統合のQE検査が両方動き、統合対象のE2E判定も維持される

### Requirement: No change diff is not regression coverage

change差分ゼロは正常な対象なしとして MUST 表示するが、製品の回帰テストやsmoke実行を省略する根拠にしてはならない。無効な比較元refやgit失敗を対象ゼロに変換してはならない。

#### Scenario: Implementation-only pull request

- **WHEN** openspecに差分がなく製品実装だけが変わる
- **THEN** 計画ゲートは対象なしを表示し、構成された回帰テスト・smokeを実行する

#### Scenario: Invalid comparison reference

- **WHEN** 比較元refが存在しない
- **THEN** 対象なし成功でなく診断付きの非ゼロ終了となる
