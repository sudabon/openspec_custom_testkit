# Tasks

## 1. 葉の定数・判定

- [x] 1.1 `critical.mjs` に `isE2eRequired(change)` を追加する。`ci-job.mjs:131`、`testkit-gate.mjs:120`、`check-test-plan.mjs:45`、`evaluate.mjs:195` を置き換え、`e2e-lint.isIntegrated`、`qe-gate:58`、`flaky:108` は `isIntegratedChange` に置き換える。`grep -n "e2e === 'required' ||"` で置き換え漏れがなく、`npm test` が通ることを確認する
- [x] 1.2 `ids.mjs` を新しく作る（`TP_ID`、`TP_ID_IN_TEXT`、`TP_REFERENCE_LOOSE`）。`coverage-map`、`plan-check`、`e2e-lint`、`report`、`markdown` の直書きを置き換え、`grep -n 'TP-\\\\d'` で lib に直書きが残っていないことと `npm test` が通ることを確認する
- [x] 1.3 `ci-job`、`evaluate` などで直書きしている `['high','medium','low']` を `RISK_LEVELS` の参照に置き換え、`lib/cli.mjs:622` の `'quality-driven-e2e'` を `SCHEMA_INTEGRATED` に置き換える。`npm test` が通ることを確認する

## 2. YAML・metadata・change 一覧

- [x] 2.1 `frontmatter.mjs` に `isPlainMapping(parsed)` と `isCustomTag(node)` を追加し、custom tag を判定する visitor の重複（Scalar、Map、Seq の3回）と `coverage-map.customTag` をまとめる。frontmatter と coverage のテストが通ることを確認する
- [x] 2.2 `change-metadata.mjs` を新しく作る（`readChangeMetadata(repo, dir, { rev, strict })`、`readDefaultSchema(repo, { strict })`、`readRiskLevel(repo, dir)`）。単体テストを追加し、strict のありなしで今の `effort` と `select` の挙動をそれぞれ再現することを確かめる
- [x] 2.3 `effort.schemaOf` / `defaultSchema` / `riskLevelOf`、`select.interpretSchema` / `configSchema`、`coverage-map.schemaOf`、`plan-check.createdOf`、`ci-job` の risk 読み込み（96-107）を 2.2 の関数に置き換える。`npm test` が通ることを確認する
- [x] 2.4 `changes.mjs` を新しく作る（`parseArchiveFolder(folder) => {date, id}`、`listActiveChanges(repo)`、`listArchivedChanges(repo)`）。`coverage-map`、`select`、`effort`、`e2e-lint.knownChanges` を置き換え、単体テストと `npm test` が通ることを確認する

## 3. policy・markdown・小さな helper

- [x] 3.1 `policy.mjs` に `POLICY_PATH`、`readPolicyText(repo)`、`policyKeyLine(text, key, { nearMiss, stripComment })`、`parseLevelList(value)` を追加する。3つのキー行パーサと、`qe-gate`、`evaluate`、`doctor`、`flaky`、`e2e-lint`、`lib/cli.mjs` のパス直書きを置き換える。flaky、qa-review、registry のテストが通ることを確認する
- [x] 3.2 `markdown.mjs` から `escapeRegExp`、`markdownCell`、`escapeHtml`、`isPlaceholderCell`、節見出しの定数、`scenarioCell(row)`、`hasScenarioColumn(row)` を export する。`coverage-map`（`cell`、`placeholder`、`norm`、Scenario 列のフォールバック）、`report.cell`、`ci-job:330`、`plan-check` の節見出しリテラルを置き換える。publishing と coverage の golden テストが変わらず通ることを確認する
- [x] 3.3 `isRecord`、`utcDate`、`errorCode(err)`、`isFsError(err)` を共通化し、`gitShow` を `git` に寄せる（違いは maxBuffer だけ）。evidence、registry、flaky のテストが通ることを確認する

## 4. エントリポイントの共通処理

- [x] 4.1 `entry.mjs` を新しく作る（`resolveRepo(cwd, { onFailure })`、`appendGithubOutput(env, kv)`、`emit(io, result)`）。`qe-gate`、`testkit-gate`、`e2e-report`、`check-test-plan`、`ci-job` の該当箇所を置き換える。`check-test-plan` は repo を解決できないとき exit 2 のまま変わらないことを、gates と contract のテストで確認する

## 5. 配布物と文書

- [x] 5.1 新しいモジュール（`changes.mjs`、`change-metadata.mjs`、`ids.mjs`、`entry.mjs`）を `REQUIRED_MODULES` と `test/distribution.test.mjs` の必須一覧に追加し、`docs/architecture.md` のモジュール一覧と `docs/migration.md` を更新する。distribution と install のテストが通ることを確認する
- [x] 5.2 `npm run lint`、`npm test`、`npm run test:smoke`、`node scripts/build-manifest.mjs --check` がすべて成功することを確認する。挙動を変えていない根拠として、既存テストの assert に変更がないこと（追加だけであること）を PR に記載する
