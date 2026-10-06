# openspec-custom-testkit

OpenSpec の品質ゲートと Playwright の E2E を、一つの導入コマンドと schema `quality-driven-e2e` でつなぐ kit です。旧 `quality-driven` と `spec-driven-e2e` の change は、それぞれの成果物形式のまま完了できます。

## 導入

Node.js 20 以上と、OpenSpec CLI 1.13.1 以上を使います。

```bash
npx github:sudabon/openspec_custom_testkit install --language Japanese
openspec init --tools claude
```

`openspec/config.yaml` を kit が作ったあと、`openspec init` に `--language` を付けるとエラーになります。言語は kit の `--language` で指定します。

同じ内容の再実行はファイル、権限、stamp の `installedAt` を変えません。`--dry-run` は未作成の target も作りません。

```bash
npx github:sudabon/openspec_custom_testkit update
npx github:sudabon/openspec_custom_testkit install --dry-run --target ../app
node scripts/testkit-gate.mjs doctor
```

install の終了コード 0 は処理が終わったことだけを表します。未移行のゲートが残るときは `移行状態: incomplete` と出ます。doctor が成功するまで統合完了ではありません。

## 人間のゲート

統合 schema では low を含む全 Risk で、人間の承認、Oracle seal、独立反証が必須です。`QE_SEAL_REQUIRED_LEVELS` と `QE_SCHEMA` では外せません。手順、役割の入力範囲、別セッションの扱い、store への非対応、保護ファイルの限界は `docs/workflow.md` と `docs/migration.md` にあります。

fixture に出る `FIXTURE-DUMMY-APPROVAL` は人間の承認ではありません。

## シナリオ対応表

```bash
node scripts/testkit-gate.mjs coverage
node scripts/testkit-gate.mjs coverage --results test-results/regression.json --strict
```

main spec の全シナリオを、archive 済み change の test-plan と照合して「保護（E2E）」「保護（他層の宣言）」「未保護」「要再確認」「孤立」に分けた表を出します。Playwright の全量実行 JSON を渡すと結果も添えます。既定は表示だけで終了コード 0、`--strict` で要対応があれば 1、入力の欠落・破損・鮮度違反、I/O エラーや引数の誤りは 2、内部エラーはスタックトレース付きの 3 です。分類の意味と段階的な導入は [docs/workflow.md](docs/workflow.md#シナリオ対応表回帰の保護範囲) にあります。

## 開発用コマンド

```bash
npm test
npm run lint
npm run test:smoke
npm pack --dry-run
```

smoke は localhost だけで動き、外部へ送信しません。browser や OpenSpec CLI が無いときに成功として skip しません。

CI の `e2e-command` は今回の Playwright JSON を `$TESTKIT_RESULTS_JSON` へ保存します。同梱 `playwright.config.example.ts` はこの変数を使用します。設定例と evidence の実行照合は [CI の組み込み例](examples/ci/README.md) を参照してください。
