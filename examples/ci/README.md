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
      e2e-command: npx playwright test
      e2e-base-url: http://127.0.0.1:4173
```

Playwright の `webServer` が localhost のサーバーを起動する構成を標準にする。browser とサーバーの依存は npm mode では `npm ci` と Playwright の導入に含まれる。

JSON reporter は `$TESTKIT_RESULTS_JSON`（絶対パス）へ今回の結果を書き出す必要がある。同梱 `playwright.config.example.ts` を採用すると、この環境変数とローカル実行用の既定パスを切り替える。`--reporter=json` は config の reporter を上書きするため、使う場合は `PLAYWRIGHT_JSON_OUTPUT_FILE="$TESTKIT_RESULTS_JSON" npx playwright test --reporter=json` とする。monorepo でもこの絶対パスを変更しない。

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
  e2e-command: pnpm exec playwright test
```

DB が必要なときは、この setup-command で起動と fixture の初期化まで行う。高度な services は呼び出し側 workflow の `services:` に書き、setup-command からそのポートへ接続する。

## monorepo

`working-directory` はインストールとコマンドの作業ディレクトリである。change の検出は git の最上位を使う。

```yaml
with:
  working-directory: frontend
  setup-mode: npm
  test-command: npm test
  e2e-command: npx playwright test
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
  e2e-command: npx playwright test
```

## 全量回帰とシナリオ対応表

`regression-command` は change の差分が無い PR でも実行する。今回の Playwright JSON を `$TESTKIT_RESULTS_JSON`（run ごとのディレクトリの `regression-results.json`）へ書く。job はその JSON で `testkit-gate.mjs coverage` と同じ対応表を作り、`coverage.md` と `coverage.json` として保存する。`report-max-age` の鮮度検査も同じく適用する。

```yaml
with:
  test-command: npm test
  regression-command: npx playwright test
  coverage-strict: false
```

`coverage-strict` が true のときだけ、対応表の要対応（未保護・要再確認・孤立・fail・未実行）を job の失敗にする。回帰コマンドが非ゼロで終わった場合は、対応表を保存したうえで job を失敗させる。結果 JSON の欠落・破損・実行エラー・鮮度違反、main spec・archive の見出しや YAML の不備などの入力エラーでは、coverage は終了コード 2 を返す。予期しない内部例外は終了コード 3 とし、スタックトレースを CI ログ・coverage.md・summary.txt に残す。進行中 change の不備は警告にして注記から除外するため、それだけでは coverage は失敗しない。レポーターと coverage のエラー詳細は CI ログと summary.txt に残し、対応表の保存に失敗した場合も summary と risk_level の出力を続ける。job は先に発生した失敗の終了コードを保持するため、回帰コマンドが既に非ゼロならそのコードで終了する。`coverage-strict` だけを指定した場合は宣言上の対応だけを検査し、fail・未実行を判定しない旨を表示する。両方とも未指定なら従来と同じ手順で動く。

## 結果の公開と PR コメント

E2E を実行すると、gate は change ごとの要約（TP-ID、テスト、project、結果、フレーク、添付）を step summary に書き、artifact `testkit-playwright-report` に今回の実行 directory（HTML レポート、添付、results.json、`<change-id>.summary.md`）を保存する。step summary の末尾には、ワークフロー実行と artifact へのリンクが付く。要約の読み方は `docs/workflow.md` の「E2E 結果の公開」にある。

添付と HTML レポートを artifact に入れるには、Playwright の `outputDir` と HTML reporter の `outputFolder` を `$TESTKIT_RUN_DIR` の配下にする（同梱 `playwright.config.example.ts` を参照）。別の場所に出した添付は、要約に「公開対象外」と表示される。

PR コメントは任意で、既定では投稿しない。有効にする場合は、呼び出し側で `pull-requests: write` を付ける。

```yaml
jobs:
  gate:
    permissions:
      contents: read
      pull-requests: write
    uses: sudabon/openspec_custom_testkit/.github/workflows/openspec-custom-testkit-gate.yml@main
    with:
      test-command: npm test
      e2e-command: npx playwright test
      publish-pr-comment: true
      artifact-retention-days: "7"
```

- コメントはマーカー `<!-- openspec-custom-testkit -->` 付きの 1 件を作成・更新する。本文はファイル経由で渡し、PR タイトルなどの文字列を shell に展開しない。
- fork からの PR など書き込み権限が無いときは、警告を出して投稿を諦める。ゲートの判定は変わらない。
- `artifact-retention-days` は、`testkit-results` と `testkit-playwright-report` の両方に適用する。空なら GitHub の既定に従う。正の整数以外はゲートの前に入力エラーになる。
- 公開系の step（artifact、リンク、PR コメント）は、ゲートが失敗しても実行し、失敗しても job の結果を変えない。

screenshot、video、trace には、画面上の個人情報、トークン、内部 URL が写ることがある。private リポジトリでも、artifact はリポジトリを閲覧できる全員が取得できる。kit は添付の中身を検査もマスキングもしない。テストデータには合成データを使い、保持日数は必要な期間に絞る。

## 旧 workflow からの変更

旧 `openspec-quality-gate.yml` と `openspec-e2e-gate.yml` の URL は変えない。新しい検査は `openspec-custom-testkit-gate.yml` を追加して呼ぶ。入力の名前は `base-ref`、`gate-phase`、`setup-mode`、`setup-command`、`e2e-command`、`e2e-base-url`、`report-max-age`、`regression-command`、`coverage-strict`、`publish-pr-comment`、`artifact-retention-days` が増えている。

## Evidence と実行記録

`revision` は検証したコミットの SHA を記録する。その後、その change の `evidence.md` だけをコミットしても final ゲートは受理する。実装、Oracle、計画、取得元ファイルなどが変わった場合は再検証する。結果ファイルも先に保存・コミットしてから revision を確定する。

CI は `test-command` / `mutation-command` の標準出力（失敗時は標準エラーも含む）と E2E の JSON を実行ごとのディレクトリに保存する。各コマンドの出力は標準出力・標準エラーそれぞれ 64 MiB までで、超えた場合は終了コードを判定できないため exit 2 で失敗する。`manifest.json` の `run_ids` は、CI が同じコマンドを実行して同じ終了コードを得た evidence の `runs[].id` である。change ID は `runs[].change_id` に分離する。出力は時刻や所要時間で実行ごとに変わるため、出力のハッシュは照合に使わない。evidence の `source` は、コミット済みファイルと `source_sha256` の一致を構造検査で確認する。final ではこの manifest を evidence と照合し、全 run を再現できた change だけを `execution: verified` と表示する。再現できない run があっても、それだけではゲートは失敗しない。manifest のないローカル検査は `execution: unverified` のままである。
