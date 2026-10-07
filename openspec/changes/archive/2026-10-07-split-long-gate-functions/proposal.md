# Proposal

## Why

ゲートとインストーラの中核になる関数がそれぞれ 100〜240 行あり、ネストも最大6段ある。そのため、規則を1つ追加するだけでも関数全体を読み直す必要があり、単体テストも CLI 全体を通してしか書けない。前段の change で共通の部品がまとまったので、それを使って関数を責務ごとに分割する。

| 関数 | 行 | 行数 |
|---|---|---|
| `ci-job.mjs` `runCiJob` | 26-269 | 約240 |
| `lib/cli.mjs` `main` | 392-628 | 約236 |
| `evidence-check.mjs` `checkEvidence` | 169-340 | 約170 |
| `coverage-map.mjs` `buildCoverage` | 338-504 | 約167 |
| `evaluate.mjs` `evaluateReadableChange` | 70-207 | 約137 |
| `plan-check.mjs` `checkTestPlan` | 251-368 | 約118 |
| `config-merge.mjs` `mergeConfig` | 71-184 | 約113 |

## What Changes

- 上の表の関数を、責務ごとの小さな関数に分ける。分割後の関数名は design.md に記載する。
- 50〜90 行の関数も同じ方針で分ける。
  - `report.classify`
  - `select.decorate`
  - `registry.checkRegistry`
  - `qa-handoff.checkHandoff`
  - `effort.buildEffort`
  - `environment.assessTarget`
  - `cli.resolvePlacement`
- `qe-gate.commandSeal` に入っている業務ロジックを `lib/seal.mjs` に移す。業務ロジックとは QA レビュー要否の判定と、quality の読み込みのこと。前者は evaluate と重複しているので、`qaReviewNeeded` 1つにまとめる。
- `testkit-gate.mjs`、`e2e-report.mjs`、`check-test-plan.mjs` を `export function main(argv, env, io)` の形にする。トップレベルの処理は import ガードの中に置き、テストから直接呼べるようにする。
- インストーラの時刻と payload root を `io` から注入できるようにする。終了コードの変換は `exitCodeFor(err)` 1つにまとめ、`install.mjs` と `lib/cli.mjs` の重複をなくす。
- **挙動は変えない**。判定、終了コード、出力の文言と順序を保つ。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

なし。内部構造の分割だけなので `skip_specs: true` とする。

## Impact

- 対象: `payload/scripts/ci-job.mjs`、`qe-gate.mjs`、`testkit-gate.mjs`、`e2e-report.mjs`、`check-test-plan.mjs`、`payload/scripts/lib/{evaluate,evidence-check,plan-check,coverage-map,report,select,registry,qa-handoff,effort,environment}.mjs`、`lib/cli.mjs`、`lib/config-merge.mjs`、`install.mjs`。新しく `payload/scripts/lib/seal.mjs` を作る。
- `seal.mjs` は `REQUIRED_MODULES` と pack の必須一覧に追加する。
- 前提: `consolidate-shared-script-helpers` が archive 済みであること。
- 対象外: `e2e-lint.mjs`（`split-e2e-lint-module` で扱う）。挙動の不一致の修正。
