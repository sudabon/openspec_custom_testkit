# safe-kit-installation Specification

## Purpose
統合 kit を既存の利用者設定や進行中の change を失わずに導入・更新する。既知の旧配布物と独自編集を区別し、安全な配置、変更予定の確認、未移行状態の診断を一つのCLIから提供する。

## Requirements

### Requirement: Idempotent installation command

CLI は install / update、--target、--dry-run、--force、--language、--e2e-root を MUST 提供する。省略時はinstallとし、同一内容の再実行はファイル内容・管理情報・権限を不必要に変更しない。

#### Scenario: Install before and after OpenSpec init

- **WHEN** 未初期化targetまたは既存OpenSpecプロジェクトへ導入する
- **THEN** どちらも導入可能で、kitがconfigを作った後のinitは --language を付けない手順を案内する

#### Scenario: Repeat installation and update

- **WHEN** 同じ版とE2E rootでinstallまたはupdateを再実行する
- **THEN** 追加の差分を作らず、変更なしを報告する

#### Scenario: Dry run on a missing target

- **WHEN** 未作成targetに --dry-run を指定する
- **THEN** 予定・差分・診断のみ出力し、target、stamp、ファイル、権限を作成・変更しない

### Requirement: Preserve user configuration and edits

CLI は言語、context、rules、他ツールのマーカー、利用者編集を MUST 保持する。差分は表示して保持し、--force は配布管理対象だけを更新する。既存 quality-policy.md と実際のPlaywright configは --force でも上書きしない。

#### Scenario: Force update with local edits

- **WHEN** 利用者がpolicy、Playwright config、配布スクリプトを編集し --force で更新する
- **THEN** policyと実configを保持し、配布スクリプトのみ明示されたforce対象として更新する

#### Scenario: Legacy context marker

- **WHEN** 旧E2Eのcontext全体を囲むマーカーと利用者の追記行が存在する
- **THEN** 既知kit行だけを新しい管理ブロックへ移し、Language、rules、他ツール行と独自追記の意味を保持する

#### Scenario: Unsupported config representation

- **WHEN** 設定を安全に解析・マージできない
- **THEN** 元ファイルを保持し、手動対応を診断し、推測で再構築したconfigを上書きしない

### Requirement: Schema and change compatibility

新規または既定spec-drivenからの導入では quality-driven-e2e を MUST 標準にする。既存quality-driven、spec-driven-e2e、その他customの既定を自動変更せず、明示的移行を案内する。旧スキーマを元の成果物形式で提供し、進行中changeの .openspec.yaml を書き換えてはならない。

#### Scenario: Custom schema and in-flight change

- **WHEN** 旧kitまたはcustom schemaが既定で進行中changeがある
- **THEN** 既定とchange metadataを保持し、新changeのみ統合スキーマを選ぶ手順を表示する

#### Scenario: Legacy change continues

- **WHEN** 旧スキーマのchangeでstatus、instructions、applyを使用する
- **THEN** QE単独にtest-plan、E2E単独にqualityを要求せず、旧形式で完了できる

### Requirement: Safe legacy migration

移行は採用元の版・内容を照合して既知の未編集ファイルを MUST 識別し、判別不能または独自編集ファイルは保持する。新ゲートへの移行が残る場合、未移行ファイルと次の操作を列挙し、統合完了と報告してはならない。旧stampは参照して保持し、新stampにkit版、E2E root、移行状態を記録する。

#### Scenario: Known and edited legacy files

- **WHEN** QEのみ、E2Eのみ、両kit導入済みのtargetを移行する
- **THEN** 既知未編集ファイルを安全に更新し、独自編集・不明な版は差分付きで保持する

#### Scenario: Critical gate remains old

- **WHEN** qe-gate、check-test-plan、e2e-report または共通モジュールの必要更新が保持される
- **THEN** 管理情報と出力が未完了を示し、統合CIの準備検査も失敗する

### Requirement: Stable and safe E2E placement

E2E root は明示引数、新stamp、旧E2E stamp、検出設定、既存ディレクトリ、既定値の優先順で MUST 解決する。配置先と配布物中の参照を一致させ、複数configの採用根拠を表示する。target外へのパス、危険な相対パス、symlink経由の逸脱は拒否する。

#### Scenario: Monorepo update

- **WHEN** 記録されたfrontend/e2eと別の検出候補が存在する
- **THEN** 記録された配置先を維持し、明示的変更時のみ移動先へ配置して旧ファイルを自動削除しない

#### Scenario: Multiple Playwright configs

- **WHEN** 同じ深さを含む複数configが見つかる
- **THEN** 浅い順・名前順の採用結果と除外候補、--e2e-rootによる指定方法を表示し、実configを上書きしない

#### Scenario: Path escapes target

- **WHEN** 引数、stamp、検出設定またはsymlinkがtarget外の書込みを指す
- **THEN** 書込み前に拒否し、target外の内容と権限を変更しない

### Requirement: Repo-local support boundary

初期版は repo-local に MUST 限定し、targetのstore宣言またはOpenSpec解決結果が外部storeを指す場合は自動配置しない。未対応として診断し、成功stampを記録してはならない。

#### Scenario: Store-backed project

- **WHEN** 導入先がstoreに計画を委譲している
- **THEN** storeにも代替のローカルopenspecにも配布せず、未対応の理由とrepo-localでの利用条件を表示する
