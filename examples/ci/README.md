# CI の組み込み例

再利用 workflow は kit リポジトリの `.github/workflows/openspec-custom-testkit-gate.yml` を `uses:` で呼ぶ。導入先へはコピーしない。コマンドは PR タイトルから作らず、入力を環境変数で渡す。`base-ref` も shell の文字列へ展開しない。

## npm

package-lock.json があるディレクトリで `setup-mode: npm` にする。kit が `npm ci` を実行し、`e2e-command` があるときは Chromium の導入も行う。pnpm や yarn の lockfile だけでは npm mode は失敗する。

```yaml
jobs:
  gate:
    uses: sudabon/openspec_custom_testkit/.github/workflows/openspec-custom-testkit-gate.yml@main
    with:
      openspec-version: "1.13.1"
      node-version: "22"
      setup-mode: npm
      working-directory: .
      base-ref: origin/main
      gate-phase: plan
      test-command: npm test
      e2e-command: npx playwright test --reporter=json
      e2e-base-url: http://127.0.0.1:4173
```

Playwright の `webServer` が localhost のサーバーを起動する構成を標準にする。browser とサーバーの依存は npm mode では `npm ci` と Playwright の導入に含まれる。

## caller

pnpm、yarn、独自 runtime、DB は同じ job の `setup-command` で用意する。別 job の環境は引き継がれない。

```yaml
with:
  setup-mode: caller
  setup-command: |
    corepack enable
    pnpm install --frozen-lockfile
    pnpm exec playwright install chromium
  test-command: pnpm test
  e2e-command: pnpm exec playwright test --reporter=json
```

DB が必要なときは、この setup-command で起動と fixture の初期化まで行う。高度な services は呼び出し側 workflow の `services:` に書き、setup-command からそのポートへ接続する。

## monorepo

`working-directory` はインストールとコマンドの作業ディレクトリである。change の検出は git の最上位を使う。

```yaml
with:
  working-directory: frontend
  setup-mode: npm
  test-command: npm test
  e2e-command: npx playwright test --reporter=json
```

## E2E を使わない

`e2e-command` を空にする。required の change があると job は失敗する。not-applicable だけ、または change 差分が無いときも、設定した `test-command` は実行する。最終検証では `test-command` を空にできない。

```yaml
with:
  gate-phase: final
  test-command: npm test
  e2e-command: ""
```

## high の Mutation

`risk_level` が high のとき `mutation-command` は必須である。閾値未満はコマンド自身が非ゼロで終了する。

```yaml
with:
  test-command: npm test
  mutation-command: npm run mutation
```

## 既存サーバー

サーバーを workflow の外で起動済みにする場合、到達確認、fixture の初期化、終了後の片付けは呼び出し側の責務である。URL は `e2e-base-url` で渡す。

```yaml
with:
  e2e-base-url: http://127.0.0.1:3000
  e2e-command: npx playwright test --reporter=json
```

## 旧 workflow からの変更

旧 `openspec-quality-gate.yml` と `openspec-e2e-gate.yml` の URL は変えない。新しい検査は `openspec-custom-testkit-gate.yml` を追加して呼ぶ。入力の名前は `base-ref`、`gate-phase`、`setup-mode`、`setup-command`、`e2e-command`、`e2e-base-url`、`report-max-age` が増えている。
