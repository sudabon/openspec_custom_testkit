# Design

## Context

動機は proposal.md の Why を参照する。現状の gate が E2E ソースを読むのは `plan-check.mjs` の `checkTagPresence` だけである。これは「`@<change-id>` と `@TP-NNN` が同じファイルにあるか」を見るもので、テスト単位の構造は解析しない。E2E ルートは `installedE2eRoot` で解決する。証跡の Residual は `evidence-check.mjs` で `id` / `reason` / `impact` / `approved_by` / `approved_at` を検査しており、反例の Residual 化で既に使っている。

導入先へ依存を追加しない方針は、`yaml` を `payload/scripts/lib/vendor/` へ bundle した前回の判断（archive 済み change の design、Decision 2）で確立している。

## Goals / Non-Goals

**Goals:**

- e2e-conventions の禁止事項のうち、構文から決定的に判定できるものを gate で失敗にする。
- 弱い Oracle（アサーション無し、存在確認だけ）を TP の実装済みとして通さない。
- 既存の導入先を一斉に赤くせず、人間の判断で強制範囲を広げられる移行経路を用意する。
- 例外を、Agent が単独で作れない承認経路に結びつける。

**Non-Goals:**

- **E2E 層への Mutation 適用。** E2E の 1 回の実行は数分単位で、変異体ごとにアプリ全体の再ビルドとブラウザ実行が必要になる。CI の時間と費用が Mutation の得る情報量に見合わない。さらに、E2E の結果は環境とフレークの影響を受ける。生き残った変異体が「Oracle が弱い」のか「実行が不安定」なのかを区別できず、判定が決定的にならない。Oracle の強さは、この change の静的な弱アサーション検査と、別 change の Unit/Integration 層の Mutation で補う。
- 型解決を伴う検査（変数経由で渡されたロケーター文字列の追跡など）。
- 自動修正（`--fix`）と、IDE 連携の提供。
- fixture・mock の登録検査（`add-fixture-and-mock-registry-checks` が扱う）と、フレーク隔離（`add-flaky-management` が扱う）。

## Decisions

### 1. 自前の軽量字句解析と括弧対応で検査する

| 方式 | 長所 | 短所 | 判断 |
|------|------|------|------|
| A. 自前の字句解析（コメント・文字列・テンプレート・正規表現リテラルを区別）と括弧対応による呼出し抽出 | 依存ゼロ。JS/TS の両方に同じ処理が使え、配布サイズが小さい | 型情報が無い。構文の網羅に限界がある | **採用** |
| B. TypeScript compiler API を vendor bundle | 正確な AST | `typescript` は数 MB あり、配布と `npm pack` が重くなる。版の追従が要る | 不採用 |
| C. ESLint プラグインとして配布 | 既存の lint 基盤と統合できる | 導入先に ESLint と parser の導入を強制する。gate の判定が導入先の lint 設定に左右される | gate には不採用。将来、任意の補助として配布する余地は残す |
| D. 正規表現だけで行単位に検索 | 最も簡単 | コメント・文字列の誤検知と、テスト単位の判定ができない | 不採用 |

A の範囲は次のとおり。トークン列から `test(` / `test.<modifier>(` / `describe` 系の呼出しを特定し、第 1 引数のタイトル、第 2 引数のオプションの `tag`、最後の関数引数の本体範囲を、括弧対応で切り出す。`expect(...)` の連鎖から matcher 名を読む（`.not` / `.soft` / `expect.poll` を含む）。

字句解析が閉じない場合（未終端の文字列・テンプレートなど）は、そのファイルを解析不能として扱い、強制範囲内なら失敗にする（spec: fail closed）。対象拡張子は、既存の `TAG_SOURCE` と同じ `.js`/`.ts` 系に揃える。`.feature` は手続きを持たないので対象外とし、`lint` の一覧で「対象外」と表示する。

### 2. 弱いアサーションの判定と helper の扱い

- 存在確認だけの matcher の集合は、`toBeVisible`、`toBeAttached`、`toBeDefined`、`toBeTruthy`、`not.toBeNull`、`not.toBeUndefined` とし、spec の列挙と一致させる。この集合は `lib/e2e-lint.mjs` の定数にする。追加は kit の更新として扱い、導入先の設定では減らせない。
- テストの全アサーションがこの集合だけなら、弱いアサーションとする。1 つでも非自明な matcher（`toHaveText`、`toHaveValue`、`toHaveURL`、`toEqual`、`toHaveCount(n)`、`toHaveScreenshot`、axe の結果に対する `toEqual([])` など）があれば通す。
- Page Object（`<e2eRoot>/pages/`）やアサーション helper を使うテストのための扱い：E2E ルート配下で export された関数のうち、本体に非自明な matcher を含むものを、事前に索引にする。テスト本体からその名前を呼んでいれば、非自明として数える。名前の解決は import の名前（別名を含む）に限り、動的に呼び出す場合は数えない。
- fixture の `base.extend()` は短縮メソッド、test の別名・再 export、function 形式の callback を含め、静的に解決できる Page Object の注入を追跡する。CommonJS の test 分割代入、namespace の `pw.test()`、直接の別名もテストとして検査する。
- 誤検知の例（意図して非自明とはしないもの）：`toBeVisible` だけで「表示されること」自体が要件のテスト。これは規則の正当な例外とし、Decision 4 の承認済み Residual で扱う。「状態の変化」を観測する Oracle に書き直すよう、lint のメッセージで促す。

### 3. 強制範囲は「change タグ ∪ 差分」、移行は policy のモードで行う

選択肢：
- (a) E2E ルート全体を強制する：導入直後に既存テストが一斉に赤くなり、導入が止まる。
- (b) change タグを持つテストだけを強制する：タグの無い既存ファイルを書き換えてアサーションを消す後退を検出できない。
- (c) **change タグ ∪ 差分で変更されたファイル（採用）**：新規 TP の弱さと既存テストの後退の両方を止める。手を付けていないファイルは警告に留まる。

差分は、既存の `selectChanges` が解決した merge-base を再利用し、`git diff --name-status <base> HEAD -- <e2eRoot>` から取る。`--base` が無いローカル実行では差分を強制しない。`scope: all` は全ソース、それ以外はタグの範囲を強制し、その旨を表示する。E2E required の change を含まない PR では check / CI の lint は起動しない。

`openspec/quality-policy.md` に、人間が編集する設定欄を追加する。

```
e2e_lint_mode: enforce        # warn | enforce（旧 schema の既定は warn）
e2e_lint_scope: changed        # changed | all
```

- 統合 schema は、`e2e_lint_mode: warn` でも、タグ付きソースは強制する（spec: Enforcement scope）。`warn` が効くのは、差分ファイルと全体範囲の強制だけである。
- 段階移行の想定：導入時は `changed` で始め、`lint` サブコマンドの警告が 0 件になった時点で、人間が `all` に上げる。
- 環境変数による上書き（`QE_E2E_LINT_MODE` など）は、旧 schema の範囲でだけ受け付ける。統合 schema では無視し、無視したことを表示する。既存の `QE_SEAL_REQUIRED_LEVELS` と同じ扱いである。
- 欄が無い場合は既定値（`enforce` / `changed`）で動く。doctor は欄が無いことを note として表示するが、失敗にはしない。policy の不正値・未知の `e2e_lint_*` キーと、旧 schema に適用する環境変数の不正値は `invalid-config` として失敗する。統合 schema では環境変数を引き続き無視する。
- policy ファイルは既に「Agent が変更してはいけないもの」に含まれ、CODEOWNERS の例でも保護対象にしている。

### 4. 例外は evidence の Residual を参照する抑止コメントだけで書く

書式：

```ts
// e2e-lint-allow weak-assertion RES-3: 表示されること自体が要件（S2）。状態変化はない
await expect(page.getByRole('banner')).toBeVisible();
```

- 書式は `e2e-lint-allow <rule-id> <residual-id>: <理由>` とする。効力は直後の 1 文、またはテスト宣言の直前に置いた場合はそのテスト全体に限る。ファイル全体を抑止する書式は用意しない。
- 参照先は、change の `evidence.md` の Execution Records にある `residuals[]` の `id` とする。検査内容は反例の Residual と同じく、`reason`、`impact`、`approved_by`、`approved_at` を見る。
- 参照先は、選択された change と、抑止対象テストの実際の change タグに対応する change（archive を含む）の和集合とする。コメント・一般文字列・同じファイルの別テストのタグは参照先を増やさない。change タグのない共有 helper 等では、archive を含む既知の全 change を候補とし、過去の承認の再利用を認める。同じ ID が選択中の evidence にあればその記録を優先し、過去の承認で未承認状態を上書きしない。優先後の候補に同じ ID が複数残れば、不正な抑止として失敗し、一意な ID への変更を求める。この候補外の change から承認を流用してはならない。
- 抑止は独立した行に限り、行末・同じ行にコードのあるブロックコメント・describe 直前は無効。書式・ID・配置の不正と存在しない Residual は範囲外や旧 schema でも plan / final ともに失敗する。未承認は強制範囲内の plan で承認待ち、final で失敗、範囲外では警告とする。
- Agent は role 定義と apply の指示により、`approved_by` を記入できない。そのため Agent が抑止を書いても final を通れない。plan では「承認待ち」の警告にして、作業を止めない。
- quality.md の Residual Risk 節を参照先にする案は採用しない。quality.md は表の自由記述で、承認者と日付をエントリ単位で検査できないからである。
- 抑止コメントそのものは E2E ルート配下にあり、既存の evidence 検査で検証対象として扱われる。そのため、Residual の承認後に抑止を増やすと、revision の再実行が必要になる。

### 5. gate への組み込み

- `evaluate.mjs` で、`change.e2e === 'required'`（旧 `spec-driven-e2e` を含む）の場合に、既存の `checkTagPresence` の後で lint を呼ぶ。字句解析の結果は、既存の `cache` に載せてファイル単位で共有する。複数の change を検査しても、ソース読み取りは 1 回にまとめる。相対 import / 再 export の fixture 解決で認識できるテスト関数が増えた場合だけ、そのファイルの解析を更新する。
- 出力は既存の `✓ / ! / ✗` の行に従う。`✗ e2e-lint weak-assertion tests/e2e/checkout.spec.ts:42 「在庫切れ商品は注文できない」` のように、規則 ID・場所・テスト名を 1 行で示す。
- `testkit-gate.mjs lint [--phase plan|final] [--base <ref>] [<change>...]` を追加する。phase の既定は plan。終了コードは、強制範囲の失敗、不正な抑止・設定、入力の読み取り失敗、検査ソース 0 件、選択・適用状態の判定失敗（計画途中の test-plan 未作成を除く）があれば 1、引数の誤りは 2、それ以外は 0 とする。`check` の終了コードの意味（0/1/2）は変えない。
- 統合 schema の doctor は、`lib/e2e-lint.mjs` の配布と、policy の設定欄があることを確認する。旧 policy に欄が無い場合は既定値で動かし、doctor は note を表示するにとどめる。統合 schema の強制は既定で効くので、欄が無いことを失敗にはしない。

## Risks / Trade-offs

- [Risk] 自前の字句解析で、JSX/TSX、正規表現リテラルと除算の判別、デコレーターなどを誤る → 正規表現リテラルは直前トークンで判別する。解析不能は fail closed にし、誤った「指摘なし」を出さない。fixture に TSX、テンプレートの入れ子、コメント内の `test.only` を含める。
- [Risk] helper 経由のアサーションを取り逃し、正しいテストを弱いと誤判定する → helper の索引は E2E ルート配下の export に限る。取り逃しの場合は、helper を E2E ルートへ移すか、承認済み Residual で例外にする。誤判定の報告は fixture の追加で回帰を防ぐ。
- [Risk] 差分の範囲が base の解決に依存し、ローカルとCIで結果が変わる → ローカルで `--base` が無い場合は「タグ範囲のみ」と表示し、CI では reusable workflow の `base-ref` を必ず渡す。
- [Trade-off] 存在確認だけの matcher の集合を固定するので、表示自体が要件の正当なテストにも例外承認が要る → QA が見る価値のある「表示要件」だけが Residual として可視化されるので、意図した負担とする。
- [Trade-off] `add-flaky-management` は `test.skip` / `test.fixme` ではなく `quarantine.md` で隔離するため、lint の除外規則とは衝突しない → 隔離を理由にした `test.skip` も lint は除外の指摘として残す。隔離の正当性は `quarantine.md` 側の検査で扱う。

## Migration Plan

1. kit の update で `lib/e2e-lint.mjs` と policy の設定欄（既定 `enforce` / `changed`）を配布する。利用者が編集した policy は、既存の保護処理で上書きしない。欄が無い場合は既定値で動く。
2. 進行中の統合 change は、次の gate 実行からタグ付きソースが強制される。既存の弱いテストは、Oracle を書き直すか、承認済み Residual で例外にする。
3. 旧 `spec-driven-e2e` の change は、既定の `warn` で指摘だけを表示する。
4. ロールバック：kit を前の版へ update すれば lint は外れる。統合 schema の強制を policy で無効にする経路は用意しない。

## PR 再レビュー反映（2026-10-06）

同じ PR 内の修正として、main spec とこの archive の delta spec / design を同期した。CI は quality.md の読み取り失敗でも summary を保存し、読み取れない risk_level は unknown と表示する。読み取り済みの risk_level は後続の入出力失敗でも維持し、内部 TypeError は入力エラーに変換しない。Residual の JSON 解析エラーを報告し、共有キャッシュの他の change のエラーを持ち越さない。
