# Spec Delta

## MODIFIED Requirements

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
