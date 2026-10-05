# e2e-convention-lint Specification

## Purpose
E2E 規約の禁止事項と弱い Oracle を、プロンプトではなく決定的な静的検査で検出する。導入先の既存テストを一斉に失敗させず、強制範囲を人間の判断で段階的に広げられるようにする。

## Requirements

### Requirement: Convention rules are statically checked

kit は、導入済み E2E ルート配下のテストソースを静的に検査し、禁止パターンごとに規則 ID・ファイル・行・テスト名を SHALL 報告する。対象は次のとおり。
- 固定待機: `waitForTimeout`、および `setTimeout` を使う sleep
- 禁止ロケーター: `page.locator` / `page.$` / `page.$$` / XPath
- 実行の除外・反転: `test` と `describe` に付けた `skip` / `only` / `fixme` / `fail`
- change タグと TP タグの欠落

コメントと、コードではない通常の文字列リテラルの中の一致は報告してはならない（MUST NOT）。ただし、ロケーター呼出しへ渡す XPath 文字列は報告する。

#### Scenario: Prohibited pattern in a test

- **WHEN** タグ付きテストが `page.waitForTimeout(1000)` や `page.locator('.btn')` を呼ぶ
- **THEN** 規則 ID・ファイル・行・テスト名を報告し、そのファイルが強制範囲内なら失敗として数える

#### Scenario: Pattern appears only in a comment or string

- **WHEN** `test.only` という文字列がコメントまたは通常の文字列リテラルの中にだけある
- **THEN** 指摘を出さない

#### Scenario: Excluded test still carries a TP tag

- **WHEN** `@<change-id>` と `@TP-001` を持つテストが `test.skip` または `test.fixme` で宣言されている
- **THEN** 除外の指摘を出し、lint の結果ではそのタグを実装済み TP として数えない

### Requirement: Tests must contain non-trivial assertions

kit は、強制範囲内のテストについて、アサーションが無いものを失敗にする。アサーションがすべて存在確認だけの matcher で構成されるものも SHALL 失敗にする。存在確認だけの matcher は `toBeVisible` / `toBeAttached` / `toBeDefined` / `toBeTruthy` / `not.toBeNull` / `not.toBeUndefined`、およびそれらの soft 形式と poll 形式とする。

アサーションとして数えるのは、テスト本体で呼ばれたもの、または E2E ルート配下から export された helper のうち、それ自体が非自明なアサーションを含むものとする。具体値・不変条件・スクリーンショット・アクセシビリティ検査結果と比較する matcher は、非自明として MUST 数える。

#### Scenario: Test without any assertion

- **WHEN** 強制範囲内のテストが操作だけを行い、`expect` を含まない
- **THEN** アサーション欠落として失敗にする

#### Scenario: Existence-only assertions

- **WHEN** 強制範囲内のテストが、複数の要素に `toBeVisible()` だけをアサートしている
- **THEN** 使われた matcher 名を示し、弱いアサーションとして失敗にする

#### Scenario: Assertion through a page object helper

- **WHEN** テストが、E2E ルート配下の Page Object helper を呼び、その helper が期待値つきの `toHaveText` をアサートしている
- **THEN** 非自明なアサーションを持つテストとして数える

### Requirement: Enforcement scope and migration mode

kit は、検査対象 change のタグを持つテストソースと、比較元から HEAD までの差分で変更された E2E テストソースについて、lint の指摘を SHALL 失敗にする。それ以外の E2E ソースは警告だけにする。ただし、人間が管理する policy が範囲を全ソースに広げた場合はその限りでない。policy は `warn` と `enforce` のモードを提供する。

統合 schema では、どの環境変数によってもタグ付きソースの強制より弱くしてはならない（MUST NOT）。policy の値が欠落または解釈不能な場合は既定値に戻し、統合 schema を警告だけに落としてはならない。

#### Scenario: Untouched legacy test

- **WHEN** 検査対象 change のタグを持たず、差分にも含まれない既存 E2E ファイルが `page.locator` を含む
- **THEN** 警告だけを表示し、それを理由に失敗しない

#### Scenario: Changed file outside the change tag

- **WHEN** PR が、change タグを持たない既存 E2E ファイルを編集してアサーションを削除する
- **THEN** 差分に含まれるため失敗する

#### Scenario: Attempt to disable via environment

- **WHEN** 環境変数で、統合 schema の change の lint モードを `warn` にしようとする
- **THEN** タグ付きソースは引き続き強制し、上書きを無視したことを表示する

### Requirement: Exceptions require an approved residual

kit は、例外を、規則 ID・理由・change の evidence にある Residual ID を書いた行内の抑止コメントとしてだけ SHALL 受け付ける。

- final では、参照先の Residual に理由・影響・人間の承認者・正しい承認日がそろっている場合だけ、抑止を通す。
- plan では、未承認の抑止を「承認待ち」として報告し、通過扱いにしない。
- Residual ID が無い抑止、または存在しない ID を参照する抑止は、両方の phase で MUST 失敗にする。

#### Scenario: Agent adds its own suppression

- **WHEN** 抑止コメントが、`approved_by` が空の Residual を参照している
- **THEN** final gate は失敗し、該当する抑止と承認の欠落を示す

#### Scenario: Approved exception

- **WHEN** 抑止コメントが、evidence 上で理由・影響・承認者・日付がそろった Residual を参照している
- **THEN** 承認済みの例外として表示し、gate を失敗させない

#### Scenario: Suppression without residual

- **WHEN** 抑止コメントに規則 ID と理由しか書かれていない
- **THEN** plan と final の両方で失敗する

### Requirement: Lint results are delivered through the existing gate

kit は、E2E 適用状態が required の change について、`testkit-gate.mjs check` の一部として lint を SHALL 実行する。また、`check` の終了コードの意味を変えずに、E2E ルート全体の指摘を一覧にする `lint` サブコマンドを提供する。

強制範囲内のソースを読めない、または字句解析できない場合は、閉じた側に倒して失敗にする。そのソースを指摘なしとして報告してはならない（MUST NOT）。lint は、導入先プロジェクトへの依存の追加を必要としてはならない。

#### Scenario: Unparseable source in scope

- **WHEN** 強制範囲内のテストソースに、字句解析で閉じられないテンプレートリテラルがある
- **THEN** そのファイルを飛ばさず、解析不能の指摘として失敗する

#### Scenario: Whole-root report

- **WHEN** 利用者が `testkit-gate.mjs lint` を実行する
- **THEN** すべての E2E ソースの指摘を強制範囲と警告範囲に分けて表示し、強制範囲の失敗がある場合だけ非ゼロで終了する

#### Scenario: Not-applicable change

- **WHEN** 検査対象 change の test-plan が `e2e: not-applicable` を宣言している
- **THEN** その change について lint を実行せず、何も報告しない
