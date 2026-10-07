# nonfunctional-test-viewpoints Specification

## Purpose
手動QAが時間を使う非機能観点を統合 schema の計画段階で必ず検討させ、割当先の Failure Mode か対象外の理由を残させる。自動化できる観点は E2E 等で観測できるよう、規約と設定例を配布する。

## Requirements

### Requirement: Non-functional viewpoint register

統合 schema の quality は `## Non-functional Viewpoints` 表を MUST 持つ。表は次の6観点を対象とする: クロスブラウザ／デバイス／レスポンシブ、見た目の回帰、アクセシビリティ、文言・多言語、性能、入力系セキュリティ。各行は観点、割り当てた Failure Mode ID、または「該当なし」とその理由を持つ。割り当てた ID は同じ quality の Failure Modes に MUST 存在する。

#### Scenario: Viewpoint assigned to a failure mode

- **WHEN** アクセシビリティ行に F3 を割り当て、F3 が Failure Modes にあり、Test Layer Mapping で E2E に割り当てられている
- **THEN** 計画ゲートはその観点を検討済みとして扱う

#### Scenario: Viewpoint references an unknown failure mode

- **WHEN** 性能行が Failure Modes に存在しない F9 を参照している
- **THEN** 計画ゲートは存在しない ID として失敗する

#### Scenario: Not applicable without reason

- **WHEN** 文言・多言語行が「該当なし」だけで理由が空である
- **THEN** 計画ゲートは理由の欠落として失敗する

### Requirement: UI-touching changes cover every viewpoint

test-plan が `e2e: required` の統合 change は、UI に触れる change として6観点すべての行を MUST 持つ。`e2e: not-applicable` の change は、6行を書くか、全観点をまとめた1行の「該当なし(理由)」で MAY 済ませる。どちらの場合も、観点の判断は人間による quality 承認の対象であり、ゲートは承認を代替しない。

#### Scenario: Required E2E change omits a viewpoint

- **WHEN** `e2e: required` の change の表に見た目の回帰の行がない
- **THEN** 計画ゲートは観点の欠落として失敗する

#### Scenario: Backend-only change

- **WHEN** `e2e: not-applicable` の change が `| 全観点 | | UI 変更なし |` の1行だけを持つ
- **THEN** 計画ゲートは通過し、各観点の行を要求しない

### Requirement: Legacy changes are not retroactively blocked

`## Non-functional Viewpoints` 表が無い change のうち、`.openspec.yaml` の `created` が kit の stamp に記録された本機能の導入日より前のものは、計画ゲートで警告として MUST 報告し、失敗にしない。`created` が無い・解釈できない、stamp に導入日が無い、または導入日以降の change で表が無ければ失敗とする。旧 `quality-driven` と `spec-driven-e2e` の change には表を要求しない。

#### Scenario: In-flight change from before the update

- **WHEN** 2026-09-30 作成の統合 change に表がなく、kit の更新が 2026-10-10 に導入された
- **THEN** ゲートは警告を表示して失敗しない

#### Scenario: Creation date cannot be read

- **WHEN** 表の無い統合 change の `.openspec.yaml` に `created` がない
- **THEN** ゲートは対象外にせず失敗する

### Requirement: Automation conventions without forced dependencies

配布する E2E 規約は、見た目の回帰に `toHaveScreenshot`、アクセシビリティに `@axe-core/playwright` を使う方法と、TP タグの付け方を MUST 示す。Playwright 設定例は複数 project（デスクトップ chromium・webkit とモバイル端末）を示す。install は導入先の `package.json` に依存を追加せず、既存の Playwright 設定を上書きしない。

#### Scenario: Install on a project without axe

- **WHEN** `@axe-core/playwright` が無いプロジェクトへ kit を導入する
- **THEN** install は依存を追加せず、規約は導入手順を案内するだけである

#### Scenario: Existing Playwright config

- **WHEN** 導入先に独自の `playwright.config.ts` がある
- **THEN** install はそれを変更せず、設定例は example ファイルとしてだけ配置する
