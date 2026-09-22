# Spec Delta

## Purpose

導入先が環境準備と品質検査の責務を理解してCIを構成できるようにし、配布物・対応環境・移行手順を検証可能な形で提供する。ローカルの成功と公開・実CIの成功を区別して報告する。

## ADDED Requirements

### Requirement: Explicit CI execution contract

統合CIはOpenSpec版、repo root、working-directory、base-ref、runtime/依存準備、テスト・Mutationコマンド、E2E base URL、レポートを MUST 明示的に受け渡す。npm向け自動setupの範囲と、pnpm/yarn等を利用者が準備する方式を区別し、browser、DB、アプリ起動の責任を文書化する。

#### Scenario: Monorepo working directory

- **WHEN** テストをfrontend等のsubdirectoryで実行する
- **THEN** changeはrepo rootで検出し、依存導入・サーバー・テストは指定directoryで動く

#### Scenario: Alternative package manager

- **WHEN** pnpm/yarn等のプロジェクトでCIを利用する
- **THEN** npm ciを無条件実行せず、利用者が明示するsetupで依存とruntimeを用意してから検査を実行する

#### Scenario: Unsupported setup

- **WHEN** 指定された実行モードの必要runtime・lockfile・browser等がない
- **THEN** 原因を診断し、対象0件や内部エラーを成功としない

### Requirement: Preserve CI failures and trusted command inputs

CIはゲート・テスト・Mutation・レポータの失敗を最終jobに MUST 伝達する。結果保存のために処理を継続しても元の失敗を失ってはならない。任意コマンドは信頼されたworkflow設定から渡し、PRタイトルなどの非信頼文字列をshell codeとして展開しない。

#### Scenario: Reporter output is saved after failure

- **WHEN** E2Eが失敗し結果表と証跡を保存する
- **THEN** 保存処理が成功しても最終jobは失敗する

#### Scenario: Only non-applicable changes

- **WHEN** すべての変更対象が理由付きE2E対象外である
- **THEN** 各changeの代替検証と構成済みsmoke・回帰テストを実行する

### Requirement: Portable and complete distribution

npm pack成果物はCLI、必要payload、共通モジュール、roles、ライセンス・出典を MUST 含み、調査checkoutや一時レポートを含めない。macOS/Linuxで使用するshellと権限に対応し、openspec updateで独自配布物が失われない構成にする。

#### Scenario: Install from packed artifact

- **WHEN** 公開前に生成したtarballを隔離targetへ導入する
- **THEN** 必要ファイルが揃いshellが実行可能で、開発checkoutへの参照なしに動作する

#### Scenario: OpenSpec command regeneration

- **WHEN** 導入後にopenspec updateを実行する
- **THEN** 独自schema、roles、scriptsが保持され、生成済みopsxを直接編集する必要がない

#### Scenario: Ignored hidden payload

- **WHEN** ルートのignore設定が.claude等を除外している
- **THEN** 配布用payloadのrolesとskillsは配布・追跡対象に含まれ、欠落は検査で検出される

### Requirement: Document compatibility and provenance

README、architecture、workflow、migration、compatibility、upstream-sources とCI例を日本語で MUST 提供する。元URL・採用SHA・MIT表示・OpenSpec fork版、CLIと旧schema互換、store制約、独立セッション、人間の承認、CODEOWNERSとbranch protectionの限界、旧workflowからの移行・戻し方を記載する。

#### Scenario: Old workflow migration

- **WHEN** 旧QE/E2E workflowを利用中の利用者が移行する
- **THEN** 新しい参照先とinputsの変更、環境準備、旧URLを残す前提、ロールバック手順を確認できる

### Requirement: Verification evidence distinguishes unexecuted work

完了報告は必須マトリクス、実Playwrightからevidenceまでのsmoke、E2E対象外の代替検証、lint、pack、互換テストの実行結果と未実行を MUST 区別する。fixture上の擬似承認やローカル成功を、実承認・GitHub Actions成功・公開導入済みの証拠にしてはならない。

#### Scenario: Local verification only

- **WHEN** ローカルCLIとpackによる検証だけを実行した
- **THEN** GitHub経由npx導入、未実行OS、hosted CI等は未検証と明記し、該当タスクを成功扱いしない

