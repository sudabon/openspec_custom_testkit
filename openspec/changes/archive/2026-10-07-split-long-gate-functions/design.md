# Design

## Context

前段の change で、共通の helper（`change-metadata`、`changes`、`ids`、`entry`、`policyKeyLine` など）ができている前提で進める。対象の関数は、どれも「直列に並んだ検査を1つの関数に詰め込み、途中で early return したり結果を配列に足したりする」形になっている。

## Goals / Non-Goals

**Goals:**
- 各関数を「入力を読む」「検査を順に呼ぶ」「結果をまとめる」の3つに分ける。個々の検査は1関数1責務にする。
- 判定ロジックを純関数として切り出し、ファイルや CLI を通さずにテストできるようにする。

**Non-Goals:**
- 判定内容、出力の文言と順序、終了コードの変更。
- パフォーマンスの改善。

## Decisions

- **検査の分け方: `check*(ctx) => { failures, notes, ... }` を順に呼び、結果を連結する**
  - 共有の配列を各関数に渡して書き換えさせる方式もある。その方が書き換え量は少ないが、出力の順序が呼び出しの順序に暗黙に依存してしまう。
  - 戻り値を連結する方式なら、順序は呼び出し元で明示されるので、こちらを採る。

- **分割後の関数**

  `ci-job.mjs`
  - `makeStepRunner(ctx)` で、`run → record → lines.push → code ||=` の8回の繰り返しを1行にする。
  - 段階ごとの関数: `runSetup`、`declaredRiskLevel`、`runE2eStage`、`e2eNote`、`runCoverageStage`、`buildRunManifest`、`evaluateAll`
  - `finish` は `writeSummaryFiles` と `writeGithubOutputs` に分ける。

  `evaluate.mjs`
  - `checkMissingQuality`、`checkRiskLevel`、`checkApproval`、`checkQaReview`、`checkSeal`、`checkFinalPhase`、`checkPlanAndTags`

  `evidence-check.mjs`
  - `checkRuns`、`checkRunRevisions`、`checkRiskResults`、`checkTraceTable`、`checkFalsification`、`checkMutation`、`checkReviews`、`checkOracleHistory`、`executionStatus`、`riskIdsOf`
  - 3回重複している構造エラー時の early return は `structureFailure(notes)` にまとめる。

  `plan-check.mjs`
  - 最初に legacy と integrated に分ける。
  - `checkNotApplicableFrontmatter`、`checkTpRows`、`checkQualityLinks`、`checkScenarioAssignment`、`checkRegistryIfNeeded`
  - ループの中で毎回作っている `layerText` は、ループの外で作る。

  `coverage-map.mjs`
  - `validateConfig`、`checkRequirementNames`、`latestDefinitions`、`scenarioOwners`、`activeNotes`、`classifyScenario`、`collectOrphans`、`collectUnresolved`
  - `planRows` からは `delegatedRows` を切り出す。

  `lib/cli.mjs`
  - 純関数: `planOps`、`decideAction`、`buildStamp`
  - I/O を伴う関数: `renderPlan`、`confirmNonGit`、`applyOps`、`printSummary`
  - 2か所で重複している「次のステップ」の出力は `nextStepsInit` にまとめる。

  `config-merge.mjs`
  - `blocked(reason)`、`migrateLegacyMarker`、`refreshMarker`、`appendToContext`

  `lib/seal.mjs`（新規）
  - `loadQuality(repo, id)`、`sealBlockers(change, data, policyText)`、`qaReviewNeeded(level, levels)`
  - evaluate の QA レビュー判定も `qaReviewNeeded` を使い、unknown level を fail-closed で扱う規則を1か所にまとめる。

- **エントリポイントの main 化は、すでにある `ci-job.mjs` の形（`export main` と `import.meta.url` のガード）に合わせる**

- **`io.now` の既定値は `() => new Date()`**
  - `cli.mjs:516,575` の時刻は、この関数から取る。
  - あわせて `legacyIndexMemo` は `loadLegacyIndex(root)` として export する。テストから drift 経路を試せるようにするため。

## Risks / Trade-offs

- [分割の途中で、検査の順序や early return の条件が変わり、出力が変わる] → 関数1つを分割するごとに `npm test` を回す。golden テスト（publishing、coverage）とメッセージの assert が変わらないことを根拠にする。差分の大きい `runCiJob` と `cli.main` は、分割前に出力全体を固定するテストを追加してから着手する。
- [PR が大きくなる] → 下の tasks のグループ単位で commit を分ける。必要ならグループ単位で PR を分けてもよい。

## Migration Plan

利用者向けの移行はない。kit を更新すると `scripts/lib/seal.mjs` が追加で配置される。
