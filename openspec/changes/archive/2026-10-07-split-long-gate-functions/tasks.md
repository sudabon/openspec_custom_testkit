# Tasks

## 1. 分割前の振る舞いを固定する

- [x] 1.1 `runCiJob` の出力（summary の行、記録されたステップ、終了コード）と `cli.main` の出力（予定一覧、dry-run、サマリ）について、代表的なケースを固定するテストがあるか確認する。足りなければ追加する。追加したテストが今のコードで通ることを確認する

## 2. 評価系（evaluate、seal、evidence-check）

- [x] 2.1 `lib/seal.mjs` を作って `loadQuality`、`sealBlockers`、`qaReviewNeeded` を実装する。`qe-gate.commandSeal` と `commandDigest`、evaluate の QA レビュー判定から使う。qa-review と gates のテストが通ることを確認する
- [x] 2.2 `evaluateReadableChange` を `check*` 関数に分ける。gates、qa-review、contract のテストが通ることを確認する
- [x] 2.3 `checkEvidence` を `check*` 関数と `riskIdsOf` / `structureFailure` に分ける。evidence と qa-handoff のテストが通ることを確認する

## 3. 計画・カバレッジ系（plan-check、coverage-map、report、select）

- [x] 3.1 `checkTestPlan` を legacy と integrated に分け、`check*` 関数に分割する。`layerText` はループの外で作る。gates、viewpoints、registry のテストが通ることを確認する
- [x] 3.2 `buildCoverage` と `planRows` を分割する。coverage の golden テストが変わらず通り、`node scripts/bench-coverage.mjs` の所要時間が大きく悪化しないことを確認する
- [x] 3.3 `report.classify`（`coverageGaps` を切り出す）と `select.decorate`（`resolveSchema` と `finalizeApplicability` に分ける）を分割する。publishing と gates のテストが通ることを確認する
- [x] 3.4 `registry.checkRegistry`、`qa-handoff.checkHandoff`、`effort.buildEffort`、`environment.assessTarget` を分割する。registry、qa-handoff、qa-review、install のテストが通ることを確認する

## 4. CI・エントリポイント

- [x] 4.1 `runCiJob` を `makeStepRunner` と段階ごとの関数に分け、`finish` も分割する。1.1 のテストと `npm run test:smoke` が通ることを確認する
- [x] 4.2 `testkit-gate.mjs`、`e2e-report.mjs`、`check-test-plan.mjs` を `export main(argv, env, io)` と import ガードの形にする。lint の結果整形は `formatLintReport` として e2e-lint 側に移す。既存の spawn 経由のテストが通り、各エントリポイントについて main を直接呼ぶテストが少なくとも1件あることを確認する

## 5. インストーラ

- [x] 5.1 `cli.main` を `planOps`、`decideAction`、`buildStamp`、`renderPlan`、`confirmNonGit`、`applyOps`、`printSummary` に分ける。`decideAction` の単体テスト（force、protected、recorded、legacyMatch の組み合わせ）を追加し、install のテストが通ることを確認する
- [x] 5.2 `io.now`、`loadLegacyIndex(root)` の export、`exitCodeFor(err)` を導入し、`install.mjs` のエラー変換を置き換える。`resolvePlacement` と `mergeConfig` も分割する。install と distribution のテストが通ることを確認する

## 6. 配布物と統合確認

- [x] 6.1 `seal.mjs` を `REQUIRED_MODULES`、pack の必須一覧、`docs/architecture.md` に追加する。distribution のテストが通ることを確認する
- [x] 6.2 `npm run lint`、`npm test`、`npm run test:smoke`、`node scripts/build-manifest.mjs --check` がすべて成功することを確認する。既存の assert の意図的な変更を記録する：`e2e-lint.test.mjs` は実装の移動に合わせて参照先を `e2e-lint/repo.mjs` に変更し、`install.test.mjs` は共有する `.claude/settings.json` を ignore しない判定へ変更した（`settings.local.json` は引き続き ignore を検証）
