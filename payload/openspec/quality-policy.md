# AI Quality Policy

このプロジェクトで Coding Agent に実装を委譲する際の品質ポリシー。
各changeの `quality.md` はこのポリシーを前提に作成する。

## 1. 役割分担

| 役割 | 担当 | 責務 |
|------|------|------|
| 正しさの定義 | 人間 | quality.md の承認、Oracle の seal、Residual Risk の受容 |
| 実装 | 実装Agent | 実装、補助テストの生成、失敗解析 |
| Oracle作成 | qe-oracle-writer(別コンテキスト) | specs と quality.md だけを入力に Oracle テストを作成 |
| 反証 | qe-falsifier(別コンテキスト) | 実装が間違っていることを証明するテストを作成 |
| QA | 人間(QA エンジニア) | qa-handoff.md の手動確認範囲と探索チャーターを実施し、QA 実施結果を記入 |
| 強制 | CI | 決定的なゲート。OpenSpec は artifact の存在しか確認しないため、強制は CI で行う |

## 2. Risk Level

| Level | 目安 |
|-------|------|
| high | 金額計算・課金、認証・認可、個人情報、データ消失・破損、外部への二重送信、不可逆な状態変更、DBマイグレーション |
| medium | 主要ユースケースの機能不全、リカバリ可能なデータ不整合、外部連携の仕様変更 |
| low | 表示・文言、内部ツール、容易にロールバックできる変更 |

<!-- プロジェクトの実情に合わせて書き換えてください -->

## 3. Quality Gate Matrix

| Gate | low | medium | high |
|------|-----|--------|------|
| quality.md の人間承認 | 必須 | 必須 | 必須 |
| Oracle の seal | 必須 | 必須 | 必須 |
| Static Analysis / 型 / Lint | 必須 | 必須 | 必須 |
| Oracle テスト全 Pass | 必須 | 必須 | 必須 |
| Falsification レビュー | 必須 | 必須 | 必須 |
| Mutation Testing | - | 任意 | 必須(閾値 70%) |
| Human Code Review | 任意 | 必須 | 必須(ドメイン担当を含む) |
| Coverage | 参考 | 参考 | 参考(差分Coverageが下がる場合は理由を evidence.md に記載) |

integrated_minimum:
mutation_threshold_high: 70
e2e_lint_mode: enforce
e2e_lint_scope: changed
mock_contract_max_age_days: 90

統合 schema `quality-driven-e2e` では low を含む全 Risk で、人間の承認、Oracle seal、独立反証が必須です。`QE_SEAL_REQUIRED_LEVELS` と `QE_SCHEMA` ではこの条件を外せません。上の表で low が「任意」のままの旧 policy は、統合 schema の doctor を通しません。

### Manual 層と QA handoff

統合 schema では Test Layer Mapping に `Manual`(探索テストを含む)を選べる。`Manual` の行には自動化しない理由が必須で、`Manual` は E2E 層とはみなさない。Manual 層、quality.md の Residual Risk、evidence の residuals のどれかがある change は、final で `qa-handoff.md` が必要になる。QA 実施結果欄は人間だけが記入し、archive の時点で実施者・実施日・`pass` の判定が必要になる。kit は記入者の本人確認をしない。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存する。旧 `quality-driven` と `spec-driven-e2e` には適用しない。

### E2E 規約 lint

`e2e_lint_mode` は `warn` か `enforce`、`e2e_lint_scope` は `changed` か `all` を人間が設定する。欠落時は既定値（`enforce` / `changed`）で動き、doctor は note を表示する。不正値・未知の `e2e_lint_*` キーは lint と doctor の両方で失敗する。

- 検査対象 change のタグ（`@<change-id>`）を持つテストソースは、統合 schema では値にかかわらず常に強制する。
- `enforce` では、比較元から HEAD までの差分で変更された E2E ソースも強制する。`all` にすると E2E ルート全体を強制する。
- `warn` では、差分と全体範囲の指摘を警告だけにする。
- 導入時は `changed` で始め、`node scripts/testkit-gate.mjs lint` の警告が 0 件になってから `all` に上げる。
- 環境変数 `QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` は旧 `spec-driven-e2e` の change にだけ効く（既定は `warn`）。統合 schema では無視する。

### fixture とモックの登録

統合 schema の `e2e: required` の change では、test-plan の `Fixture` 列にある fixture 名が E2E ルートの `fixtures/README.md` に登録され、その行の「使用する TP-ID」に `<change-id>:TP-NNN` があることを計画ゲートで検査する。`mock:<name>` と書いたモックは `mocks/README.md` の `## モック一覧` に全列（モック名・対象サービス・契約の出典・整合の確認方法・最終確認日）が必要になる。

- モックの最終確認日から検査日までに許す日数（正の整数）は `mock_contract_max_age_days` で設定する。欠落時は 90 日。不正値と書式違いは doctor と最終検証ゲートの失敗になる。
- 最終検証ゲートは上限を超えたモックを失敗にする。照合し直して最終確認日を更新するか、モック名を含む人間承認済みの Residual（approved_by と approved_at）を evidence に記録する。鮮度は検査日に依存する。
- 最終確認日は人間が実物と照合して更新する。CI の `contract-command` の成功でも自動更新しない。
- fixture の冪等性とテスト間の状態非共有は機械検査しない。medium 以上の Human Code Review の確認項目とする（§5）。
- 旧 `spec-driven-e2e` の change では登録の不整合を警告だけにする。旧 `quality-driven` と `e2e: not-applicable` には適用しない。

### フレーク方針

既定では、リトライ後に成功した flaky のテストを pass として coverage に数え、⚠ を表示する。Risk の Level に応じて flaky を不合格にする場合は、人間が `flaky_fail_levels: [high]` を独立した行として追記する。インデント・箇条書き記号・バッククォートを付けず、キーとコロンの間も空けない（例: `[medium, high]`）。

- 列挙した Level の Risk に紐づく TP（test-plan の Risk 列 → quality.md の Risk Register の Level）が flaky になると、reporter は終了コード 3 で失敗する。複数の TP を持つテストは最も高い Level で判定する。Level を解決できない TP の flaky は不合格として扱う。
- 列挙していない Level の flaky は pass として数え、警告を表示する。
- low / medium / high 以外の値、角括弧の無い値、設定らしい行の書式違い（単数形のキーなど）は、doctor と reporter の入力エラーになる。行を消せば従来の動作に戻る。
- 壊れたテストを期限付きで外す場合は、E2E ルート直下の `quarantine.md` に登録する（手順は `quarantine.md` の説明と openspec-custom-testkit の docs/workflow.md）。旧 `spec-driven-e2e` の change には、フレーク方針も隔離リストも適用しない。

## 4. Agent が変更してはいけないもの

- quality.md frontmatter の `approved_by` / `approved_at` / `oracle_digest`
- qa-handoff.md の QA 実施結果欄(実施者・実施日・判定・所見)
- seal 済みの `oracle_paths` 配下
- このファイル、`openspec/schemas/`、`scripts/qe-gate.sh`、`.github/workflows/`

## 5. Human Review が必須の変更

- risk_level が medium 以上の change
- seal 後の Oracle 変更、Residual Risk の追加
- 認証・認可・課金・個人情報に触れる変更(risk_level に関わらず)

medium 以上の Human Code Review で、E2E の fixture を追加・変更した change は次も確認する(ゲートは検査しない):

- fixture が各テストの前に状態をべき等に作り直すこと(同じ fixture を2回実行しても同じ状態になる)
- テスト間で状態を共有しないこと(実行順を入れ替えても、単独で実行しても結果が変わらない)

## 6. 禁止パターン(Reward Hacking)

- テスト入力での分岐、期待値のハードコード
- アサーションの緩和、skip / only / xfail の追加
- テスト対象そのもののモック化
- 期待値を実装の出力から逆算すること
- 「全テスト Pass」だけを根拠に完了報告すること
