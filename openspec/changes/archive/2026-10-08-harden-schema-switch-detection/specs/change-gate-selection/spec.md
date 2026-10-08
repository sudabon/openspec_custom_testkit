# Spec Delta

## MODIFIED Requirements

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
