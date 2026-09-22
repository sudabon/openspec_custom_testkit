# integrated-quality-workflow Specification

## Purpose
QE と E2E の計画成果物を一つの依存関係で提供し、受け入れ基準から独立した検証と人間の承認までの責務を明確にする。実行後の証跡と計画の完了を区別し、架空の仕様や承認を必要としない運用を可能にする。

## Requirements

### Requirement: Planning artifact dependency graph

統合スキーマは proposal、specs、quality、design、test-plan、tasks を提供し、以下の依存関係を MUST 満たす: specs←proposal、quality←specs、design←proposal+quality、test-plan←specs+quality、tasks←specs+quality+design+test-plan。apply の開始条件は tasks とし、全計画ファイルを入力として利用可能にする。evidence は実行後に作り、apply の開始依存に含めてはならない。

#### Scenario: Plan progresses through the declared dependencies

- **WHEN** proposal と specs を完成させる
- **THEN** quality が ready となり、quality 完成後は design と test-plan が互いに依存せず作成可能になる

#### Scenario: Apply receives all planning inputs

- **WHEN** すべての計画成果物を完成させ apply instructions を取得する
- **THEN** specs、quality、design、test-plan、tasks の入力を確認でき、evidence が未作成でも apply の計画上の開始条件を満たす

### Requirement: Artifact sources of truth

受け入れ基準は specs、Risk / Failure Mode / Oracle / Test Layer は quality、E2E の具体的観点は test-plan を正本として MUST 扱う。quality は最大Riskを risk_level とし、具体的な観測点と期待状態を持つ。test-plan は新しい受け入れ基準を追加せず、全シナリオの検証先を記録する。

#### Scenario: Trace from scenario to evidence

- **WHEN** 状態変化や副作用を伴うシナリオを計画する
- **THEN** Scenario → Risk → Failure Mode → Oracle → 検証層 → 該当時TP-ID → 証跡を辿れ、HTTPステータスや存在確認だけで期待状態の検証を代用しない

#### Scenario: Unit oracle has no E2E identifier

- **WHEN** Oracle を Unit / Integration に割り当てる
- **THEN** TP-ID は要求せず、RiskとOracleから代替検証結果を追跡できる

### Requirement: Human gates for every integrated risk level

統合版の policy、schema instructions、templates、実行ゲートは low / medium / high の全Riskで人間の quality 承認、Oracle seal、独立した反証を MUST 要求する。high の Mutation は70%以上を初期閾値とし、Human Code Review は medium/high で必須、high ではドメイン担当を含む。既存プロジェクトのより厳しい基準を緩和してはならない。

#### Scenario: Low risk still requires seal and falsification

- **WHEN** 統合 change の risk_level が low である
- **THEN** sealと独立反証を省略できず、旧policyのlow任意記述や環境変数で統合版の必須条件を弱められない

#### Scenario: Agent reaches a human gate

- **WHEN** 実プロジェクトで未承認のqualityまたは未sealのOracleに到達する
- **THEN** Agentは対象ファイルと必要な人間操作を提示して停止し、approved_by、approved_at、oracle_digest を代筆しない

#### Scenario: Synthetic approval remains a fixture

- **WHEN** kit の隔離自動テストで承認・sealを再現する
- **THEN** ダミー値をfixtureと明記し、実プロジェクトの承認済み証拠に数えない

### Requirement: Independent verification context

Oracle writer の入力は specs、quality、policy、呼出しに必要な公開インターフェース、意味を追加しないTP-ID対応だけに MUST 限定する。design、実装本体、実装Agentの推論・会話を期待値の決定に用いてはならない。Falsifier は specs、quality、実装差分から反例を作り、製品コードとseal済みOracleを修正してはならない。

#### Scenario: No isolated agent facility is available

- **WHEN** 実行基盤が別コンテキストを起動できない
- **THEN** 独立セッション用の入力一覧と引継ぎ手順を提示し、同一会話内の役割変更を独立検証済みとしない

#### Scenario: Oracle is itself an E2E test

- **WHEN** Oracle の検証層が E2E である
- **THEN** Oracle段階で対象テストを作り意味のあるREDを確認し、後段では同じTP-IDを重複実装しない

### Requirement: Spec skipping without invented requirements

skip_specs: true の仕様変更を伴わない change でも quality と test-plan は MUST 作成し、仕様を新設せず、proposalと変更範囲を基にRisk、検証先、対象外理由を記録する。skip_specs 自体をE2E対象外や品質ゲート免除の根拠としてはならない。

#### Scenario: Documentation-only plan

- **WHEN** 純粋な文書変更で skip_specs: true が宣言される
- **THEN** specs は skipped のまま、quality と理由・代替検証を持つtest-planを作成でき、全Riskの承認・seal・反証要件を保持する

### Requirement: Task sequence preserves oracle independence

配布tasksは Oracle作成とRED・人間seal、製品実装とfixture、TP-ID別E2E、独立反証と必要なMutation、evidenceと最終ゲートの順に MUST 構成する。各チェックボックスに完了条件を含め、先行harnessは実行可能なREDに必要な最小限に限定する。

#### Scenario: Task completion before seal

- **WHEN** 番号2以降の実装タスクをseal前に完了扱いにする
- **THEN** ゲートが検出し、タスク記録だけで実際のファイル編集時刻を証明できるとは説明しない
