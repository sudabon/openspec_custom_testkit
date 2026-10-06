# Proposal

## Why

`payload/.claude/skills/e2e-conventions/SKILL.md` の禁止事項（固定待機、CSS/XPath ロケーター、skip/only、アサーションの緩和）は、Agent へのプロンプトとしてしか効いていない。gate はタグの存在と実行結果は照合するが、テスト本体を読まない。そのため、`expect` の無いテストや `toBeVisible` だけのテストが TP を満たしたとして Green になる。QA はその Green を信用できず、手で確認し直すことになる。Mutation は high の非 E2E 層にしか適用されず、E2E Oracle の強さを測る手段が無い。

## What Changes

- E2E テストソースを静的に検査する linter を配布 gate に追加する。検査規則は次のとおり。
  - 固定待機: `page.waitForTimeout`、および `setTimeout` を使う sleep
  - 禁止ロケーター: `page.locator` / `page.$` / `page.$$` / XPath
  - 実行の除外・反転: `test.skip` / `test.only` / `test.fixme` / `test.fail`（`describe` 系を含む）
  - アサーションの無いテスト
  - 存在確認だけのアサーションで構成されたテスト
  - `@<change-id>` と `@TP-NNN` のタグ欠落
- 検査を強制する範囲を「検査対象 change のタグを持つテスト」と「比較元からの差分で変更された E2E テストソース」に絞る。手を付けていない既存テストは警告に留め、導入先が一斉に赤くならないようにする。強制範囲は人間だけが編集する policy で段階的に広げられる。
- 規則の例外は、理由と evidence の Residual ID を付けた抑止コメントでだけ書ける。final では、人間承認済みの Residual に紐づかない抑止を失敗にする。Agent が自分で抑止を書いても、gate は通らない。
- 外部依存を追加しない。既存の YAML vendor bundle と同じく、導入先の package.json を変えない。
- `testkit-gate.mjs lint` サブコマンドで、E2E ルート全体の結果を参考表示する。

## Capabilities

### New Capabilities

- `e2e-convention-lint`: E2E 規約の静的検査規則、強制範囲と移行モード、例外の承認経路、gate と CI への結果伝達。

### Modified Capabilities

なし。既存 capability の要件は変えない。`e2e-plan-reporting` のタグ存在検査（同一ファイル内の文脈一致）は維持する。lint はそれに加えて、テスト単位でタグを検査する。

## Impact

- 対象: `payload/scripts/lib/`（新規 `e2e-lint.mjs`）、`payload/scripts/lib/evaluate.mjs`、`payload/scripts/testkit-gate.mjs`、`payload/openspec/quality-policy.md`（強制モードの設定欄）、`payload/.claude/skills/e2e-conventions/SKILL.md`（lint との対応と抑止の書き方）、`test/` の fixture、`docs/workflow.md`、`docs/migration.md`。
- 互換: 旧 `spec-driven-e2e` の change では、既定で警告モードにする。統合 schema の change では、強制範囲内を失敗にする。`check-test-plan.sh` と reporter の既存の終了コードは変えない。
- 関連 change:
  - `add-flaky-management`: 隔離リストで除外したテストを、lint の `test.skip` 検出と矛盾させないための取り決めが要る。隔離は lint の例外ではなく、隔離リスト側で扱う前提にする。
  - `add-nonfunctional-test-viewpoints`: `toHaveScreenshot` と axe の結果検証を、強いアサーションとして規則表に含める。
  - `add-fixture-and-mock-registry-checks`: fixture と mock の登録検査はそちらで扱い、この change では扱わない。
- 対象外: E2E 層への Mutation 適用、TypeScript の型解決を伴う検査、ESLint の必須化、自動修正（fix）。
