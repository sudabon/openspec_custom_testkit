# Spec Delta

## Purpose
E2E 規約の禁止事項と弱い Oracle を、プロンプトではなく決定的な静的検査で検出する。導入先の既存テストを一斉に失敗させず、強制範囲を人間の判断で段階的に広げられるようにする。

## ADDED Requirements

### Requirement: Convention rules are statically checked

kit は、導入済み E2E ルート配下のテストソースを静的に検査し、禁止パターンごとに規則 ID・ファイル・行・テスト名を SHALL 報告する。対象は次のとおり。
- 固定待機: `waitForTimeout`、および `setTimeout` を使う sleep
- 禁止ロケーター: `page.locator` / `page.$` / `page.$$` / XPath
- 実行の除外・反転: `test` と `describe` に付けた `skip` / `only` / `fixme` / `fail`
- change タグと TP タグの欠落

コメントと、コードではない通常の文字列リテラルの中の一致は報告してはならない（MUST NOT）。ただし、ロケーター呼出しへ渡す XPath 文字列は報告する。型解析は行わないため、`fill()` のように Locator では値を取るメソッドは、受け手が Page / Frame と名前で判定できる場合にだけ第 1 引数を検査する。

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

統合 schema では、どの環境変数によってもタグ付きソースの強制より弱くしてはならない（MUST NOT）。policy の値が欠落した場合は既定値に戻し、統合 schema を警告だけに落としてはならない。policy の不正値・未知の `e2e_lint_*` キー、および旧 schema に適用する環境変数の不正値は、検査結果に違反がなくても MUST 失敗にする。統合 schema に対する環境変数は引き続き無視する。

#### Scenario: Untouched legacy test

- **WHEN** 検査対象 change のタグを持たず、差分にも含まれない既存 E2E ファイルが `page.locator` を含む
- **THEN** 警告だけを表示し、それを理由に失敗しない

#### Scenario: Changed file outside the change tag

- **WHEN** E2E required の change を含む PR が、change タグを持たない既存 E2E ファイルを編集してアサーションを削除する
- **THEN** 差分に含まれるため失敗する

#### Scenario: Invalid lint configuration

- **WHEN** policy に `e2e_lint_scope: ALL`、または旧 schema の環境変数に `QE_E2E_LINT_MODE=ENFORCE` が指定される
- **THEN** `invalid-config` として失敗し、緩い設定へ黙ってフォールバックしない

#### Scenario: Attempt to disable via environment

- **WHEN** 環境変数で、統合 schema の change の lint モードを `warn` にしようとする
- **THEN** タグ付きソースは引き続き強制し、上書きを無視したことを表示する

### Requirement: Exceptions require an approved residual

kit は、例外を、規則 ID・理由・change の evidence にある Residual ID を記載し、独立した行に置いた抑止コメントとしてだけ SHALL 受け付ける。

- 強制範囲内の final では、参照先の Residual に理由・影響・人間の承認者・正しい承認日がそろっている場合だけ、抑止を通す。
- 強制範囲内の plan では、未承認の抑止を「承認待ち」として報告し、通過扱いにしない。
- 強制範囲外の未承認抑止は警告とする。
- Residual ID が無い抑止、または存在しない ID を参照する抑止は、強制範囲や schema にかかわらず両方の phase で MUST 失敗にする。書式・規則 ID・配置が不正な抑止も同じ扱いとする。

参照先は、選択された change と、抑止対象テストの実際の change タグに対応する change（archive を含む）の和集合とする。テスト内の抑止では、そのテストと囲んでいる describe のタグを使い、別テストのタグは参照先を増やさない。フック等のテスト外の抑止では、囲んでいる describe の change タグを使い、それが無い場合は同じファイル内のテスト・describe のタグを使う。コメント・一般文字列は参照先を増やさない。全履歴を候補にするのはテスト・describe の宣言が無い helper 専用ファイルに限り、archive の過去の承認の再利用を認める。選択されていない change の evidence に Execution Records が無い場合は Residual なしと扱うが、JSON の破損や読み取り失敗はエラーとする。同じ ID が選択中の evidence にあればその記録を優先し、過去の承認で未承認状態を上書きしない。優先後の候補に同じ ID が複数残れば、不正な抑止として失敗し、一意な ID への変更を求める。この候補外の change から承認を流用してはならない。Residual ID は候補となる change 間で衝突しないよう、`RES-demo-001` のように change 名を含めて採番することを推奨する。`RES-1` のような ID を再利用すると、選択中の同名記録が過去の抑止にも優先され、承認を取り消したり意図せず承認したりする。archive 間の同名 ID も helper の参照を曖昧にするため、既存 ID を変更するときは evidence と抑止コメントを一緒に更新する。`old/RES-1` のような名前空間を解釈する機能は無い。 kit はこの参照規則を MUST 適用する。ブロックコメントと同じ行にコードがある配置も、独立した行とはみなさない。

#### Scenario: Historical approval cannot be selected by a comment

- **WHEN** `@demo` のテストの抑止に、コメントだけで `@old` を追加する
- **THEN** archive の old の承認を流用しない。demo の未承認 Residual は未承認のままとする

#### Scenario: Current approval on a historical test

- **WHEN** 過去の change タグを持つテストを編集し、選択中の change が承認した新しい Residual ID で抑止する
- **THEN** 選択中の evidence も参照し、承認済み例外として扱う

#### Scenario: Untagged shared helper keeps an existing exception

- **WHEN** タグのない helper の抑止が archive の一意な承認済み Residual を参照する
- **THEN** 別の change の検査や change 指定なしの lint でも承認を引き継ぐ

#### Scenario: Agent adds its own suppression

- **WHEN** 強制範囲内の抑止コメントが、`approved_by` が空の Residual を参照している
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
- **THEN** すべての E2E ソースの指摘を強制範囲と警告範囲に分けて表示し、強制範囲の失敗、不正な抑止・設定、入力の読み取り失敗、検査ソース 0 件、選択・適用状態の判定失敗がある場合に非ゼロで終了する

#### Scenario: Pending test plan

- **WHEN** 選択された change が計画途中で test-plan 未作成である
- **THEN** lint はその change を適用状態の判定失敗として扱わない

#### Scenario: Not-applicable change

- **WHEN** 検査対象 change の test-plan が `e2e: not-applicable` を宣言している
- **THEN** その change について lint を実行せず、何も報告しない
