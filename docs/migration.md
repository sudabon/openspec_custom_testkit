# 移行

## 導入

```bash
npx github:sudabon/openspec_custom_testkit install --language Japanese
npx github:sudabon/openspec_custom_testkit update
npx github:sudabon/openspec_custom_testkit install --dry-run --target ../other
```

終了コードは 0 が処理の正常終了、1 が実行失敗、2 が引数不正である。0 は統合完了を意味しない。未移行が残るときは出力と `.openspec-custom-testkit.json` の `migration.status` が `incomplete` になる。完了の確認は導入先で次を実行する。

```bash
node scripts/testkit-gate.mjs doctor
```

doctor が失敗するあいだ、統合 CI の準備はできていない。

既定 schema が `spec-driven` のときだけ `quality-driven-e2e` に切り替える。`quality-driven`、`spec-driven-e2e`、その他の schema は自動変更しない。新しい change は次で作る。

```bash
openspec new change <name> --schema quality-driven-e2e
```

進行中 change の `.openspec.yaml` は書き換えない。既存の `quality-policy.md` と実在の Playwright config は `--force` でも上書きしない。旧 policy の low「任意」のままでは doctor が失敗する。kit は差分と追記例を出し、人間が policy を更新する。

## E2E 規約 lint の段階移行

kit の update で `scripts/lib/e2e-lint.mjs` を配布する。導入先の package.json は変えない（外部依存を追加しない）。既存の `quality-policy.md` は上書きしないので、強制範囲を設定する場合は人間が次の行を追記する。

```
e2e_lint_mode: enforce        # warn | enforce
e2e_lint_scope: changed       # changed | all
```

欄が無い、または値が不正な場合は既定値（`enforce` / `changed`）で動く。doctor は欄が無いことを note として表示するが、失敗にはしない。

1. 導入時は `changed` で始める。統合 schema の change は、次の gate 実行からタグ付きソースと差分ファイルが強制される。既存の弱いテストは Oracle を書き直すか、人間承認済み Residual で例外にする。
2. `node scripts/testkit-gate.mjs lint --base <ref>` で警告範囲の指摘を確認し、既存テストを直す。
3. 警告が 0 件になった時点で、人間が `e2e_lint_scope: all` に上げる。以後は E2E ルート全体が強制範囲になる。

統合 schema では、`e2e_lint_mode: warn` でもタグ付きソースは強制する。`warn` が弱めるのは差分ファイルと全体範囲だけである。環境変数 `QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` は旧 `spec-driven-e2e` の change にだけ効き、統合 schema では無視したことを表示する。旧 `spec-driven-e2e` の change は既定の `warn` で指摘だけを表示する。

戻すときは kit を前の版へ update する。統合 schema の強制を policy で無効にする経路は用意していない。

## 既知の旧ファイル

旧 stamp の版が QE 0.1.2 または E2E 0.2.0 で、内容が baseline に E2E root 変換を適用したバイトと一致するファイルだけを自動で置き換える。不明な版と独自編集は差分を表示して残す。必須ゲートが残ると install は 0 でも doctor は非ゼロになる。旧 stamp は読まない限り変更しない。

戻すときは、導入で上書きしたファイルを git で戻し、`.openspec-custom-testkit.json` を削除する。旧 stamp は残してあるので、旧 CLI のファイルを戻したあとに旧 kit の状態へ戻せる。policy と Playwright config は最初から上書きしていない。

## 配置先

E2E root は `--e2e-root`、新 stamp、旧 E2E stamp、静的な `testDir`、既存ディレクトリ、`tests/e2e` の順で決める。動的な config は実行しない。記録した root は、別の検出候補があっても維持する。root を変えても古いファイルは削除しない。

target の外、`..`、symlink 経由の逸脱は force と dry-run を含めて書き込み前に拒否する。

store 宣言、外部 root、global defaultStore には配置しない。成功 stamp も書かない。OpenSpec CLI が無い、または 1.13.1 未満のときはファイル準備だけを行い、ready とは報告しない。
