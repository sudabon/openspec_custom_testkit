---
name: e2e-conventions
description: Playwright E2Eテストの実装規約。openspec change の apply で test-plan.md
  からテストを実装するとき、既存E2Eテストを修正・レビューするとき、E2Eテストの失敗を
  調査するときは必ずこのスキルを参照すること。tests/e2e/ 配下を触る作業すべてが対象。
---

# E2E実装規約

## ロケーター
- getByRole / getByLabel / getByText を最優先。次点 getByTestId
- page.locator() / page.$() / page.$$() と XPath は禁止。CSS のクラス名だけでなく、
  要素名だけの指定も禁止(`locator('article')` ではなく `getByRole('article')` を使う)
- アクセシブルネームに依存するため、UI文言の変更は仕様変更として test-plan に反映してから行う

## 構造
- Page Object Model: セレクタとページ操作は tests/e2e/pages/ に分離
- fixture は tests/e2e/fixtures/ に置き、fixture 名と作られる状態の対応を
  同ディレクトリの README.md に記録する
- 外部依存のモックは tests/e2e/mocks/ に置く。テストファイル内に直接書かない
- セットアップ/テアダウンは fixture で行う。テスト本体でのログイン操作の繰り返しは禁止
- 1テスト = 1検証意図。テスト間の順序依存は禁止(各テストが独立して実行可能であること)

## 安定性
- page.waitForTimeout / sleep は禁止。自動待機ロケーターと expect のリトライに任せる
- 外部SaaS(決済・メール等)はモック(tests/e2e/mocks/)。自社サービス境界内は実物を使う

## タグとトレーサビリティ
- すべてのテストに { tag: ['@<change-id>', '@TP-NNN'] } を付与する。change id と TP-ID はトークン境界で一致させる。接頭辞や正規表現の部分一致では coverage にしない
- タグがファイルにあるだけでは実行済みにしない。Playwright の実 attempt がある expected または flaky だけを coverage にする
- 計画ゲートのタグ存在検査は E2E ルート配下のテストソース（`.js`/`.ts` 系と `.feature`）だけを読む。README や画像・trace のタグは数えない
- テスト名は test-plan.md の Intent と Expected を日本語で要約したものにする

```ts
test('在庫切れ商品は注文できない', { tag: ['@add-checkout', '@TP-002'] }, async ({ page }) => {
  // ...
});
```

## 禁止事項
- 失敗を通すためのアサーション緩和・削除は禁止。期待値の変更が必要な場合は
  仕様変更なので、変更せずに人間へエスカレーションする
- `test` / `describe` への skip / only / fixme / fail の付与は禁止（条件つきの `test.skip()` も含む）
- アサーションの無いテスト、存在確認だけ（`toBeVisible` など）のテストは禁止。具体値・状態の変化・スクリーンショット・axe の結果と比べる

## lint との対応

gate（`node scripts/testkit-gate.mjs check` / `lint`）は E2E ルート配下の `.js` / `.ts` 系ソースを静的に検査する。
上の規約と lint の規則 ID は次のとおり対応する。

| 規約 | 規則 ID | 備考 |
|------|---------|------|
| page.locator() / page.$() / page.$$() と XPath の禁止、CSS・要素名だけの指定の禁止 | `forbidden-locator` | `locator()` / `$` / `$$` / `$eval` / `$$eval` の呼出しと、セレクタ引数の XPath 文字列 |
| getByRole / getByLabel / getByText を最優先、次点 getByTestId | lint 対象外 | どれが最適かは画面の意味で決まり、構文から判定できない |
| UI 文言の変更を test-plan に反映してから行う | lint 対象外 | 仕様変更の判断で、ソースからは判定できない |
| Page Object Model、fixture、mocks の配置と README | lint 対象外 | fixture と mock の登録検査は別 change（add-fixture-and-mock-registry-checks）が扱う |
| テスト本体でのログイン操作の繰り返し禁止、1 テスト = 1 検証意図、順序依存の禁止 | lint 対象外 | 意図と実行時の依存は構文から決定的に判定できない |
| page.waitForTimeout / sleep の禁止 | `fixed-wait` | `waitForTimeout()` と `setTimeout` を使う sleep |
| 外部 SaaS のモック | lint 対象外 | 通信先の判定に実行時情報が要る |
| すべてのテストに `@<change-id>` と `@TP-NNN` を付ける | `missing-tag` | テスト単位で検査する。describe とタイトルのタグも数える。計画した TP を持つ有効なテストが無い場合も報告する |
| 実 attempt だけを coverage にする、タグ存在検査の対象 | lint 対象外 | reporter と計画ゲートが扱う |
| テスト名を Intent と Expected の日本語要約にする | lint 対象外 | 文章の妥当性は構文から判定できない |
| アサーションの緩和・削除の禁止 | `missing-assertion` / `weak-assertion` | 差分で変更されたファイルも強制範囲に入るので、既存テストからの削除も止まる |
| skip / only / fixme / fail の禁止 | `excluded-test` | 除外されたテストの TP は lint 上の実装済みに数えない |
| アサーションの無いテスト・存在確認だけのテストの禁止 | `missing-assertion` / `weak-assertion` | 存在確認だけの matcher: `toBeVisible` / `toBeAttached` / `toBeDefined` / `toBeTruthy` / `not.toBeNull` / `not.toBeUndefined`（soft・poll 形式を含む） |

規約に対応しない検査として、字句解析できないソース（`unparseable`）、読み取れないソース（`unreadable`）、無効な抑止コメント（`invalid-suppression`）がある。強制範囲内ではどれも失敗になる。

E2E ルート配下で export された関数と Page Object のメソッドのうち、本体に非自明な matcher を持つものは、import した名前（別名を含む）で呼べばアサーションとして数える。テストファイル内だけの helper と、動的な呼出しは数えない。

### 例外（抑止コメント）

```ts
// e2e-lint-allow weak-assertion RES-3: 表示されること自体が要件（S2）。状態変化はない
await expect(page.getByRole('banner')).toBeVisible();
```

- 書式は `e2e-lint-allow <rule-id> <residual-id>: <理由>`。効力は直後の 1 文だけ。テスト宣言の直前に置いた場合はそのテスト全体に効く。ファイル全体を抑止する書式は無い
- 抑止は人間承認済み Residual が必要。`<residual-id>` は change の `evidence.md` の Execution Records にある `residuals[]` の `id` で、`reason` / `impact` / `approved_by` / `approved_at` がそろっている必要がある
- Agent は `approved_by` を記入しない。Agent が抑止を書いても plan では「承認待ち」の警告になり、final は通らない
- Residual ID の無い抑止と、存在しない ID を参照する抑止は plan と final の両方で失敗する
- `toBeVisible` だけで済ませたい場合も、まず状態の変化を観測する Oracle に書き直せないか検討する。抑止は人間へエスカレーションしてから書く

### CI の結果出力先

`TESTKIT_RESULTS_JSON` が設定された実行では、その絶対パスへ JSON reporter の結果を保存する。同梱 example config はこの変数を使用する。CLI で reporter を上書きする場合は `PLAYWRIGHT_JSON_OUTPUT_FILE="$TESTKIT_RESULTS_JSON" npx playwright test --reporter=json` を使う。ローカルの既定パスを CI で固定使用しない。
