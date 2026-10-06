# 検証ログ

記録日: 2026-09-22 19:01 JST。ホストは Darwin。push、npm 公開、旧 checkout の変更はしていない。

## コマンド

| コマンド | Node | 結果 |
|---|---|---|
| `npm run lint` | 23.7.0 | 成功。168 files scanned。失敗 0、skip 0 |
| `node --test test/*.test.mjs` | 23.7.0 | 39 pass / 0 fail / 0 skipped |
| `node --test test/*.test.mjs` | 20.6.0 | 39 pass / 0 fail / 0 skipped |
| `node --test test/*.test.mjs` | 22.14.0 | 39 pass / 0 fail / 0 skipped |
| `npm run test:smoke` | 23.7.0 | 成功（exit 0） |
| `node test/smoke.mjs` | 20.6.0 | 成功（exit 0） |
| `node test/smoke.mjs` | 22.14.0 | 成功（exit 0） |

`npm test` は `node --test test/*.test.mjs` と同じである。smoke は localhost の fixture だけで、外部へ送信しない。`FIXTURE-DUMMY-APPROVAL` は人間の承認ではない。

## 未実施

| 環境 | 理由 |
|---|---|
| Linux × Node 20 | Docker daemon が停止しており、Linux ホストでも実行していない |
| Linux × Node 22 | 同上 |
| hosted GitHub Actions | workflow ファイルの検査と local harness で代替しない |
| 公開レジストリの `npx` | `npm pack` と tarball からのローカル導入だけを確認した |

OpenSpec CLI はローカルの 1.13.1 で、三 schema の validate、`quality-driven-e2e` の新規 change、skip_specs、apply readiness を確認した。

## add-regression-coverage-map

記録日: 2026-10-06 JST。ホストは Darwin、Node v26.2.0。push、npm 公開はしていない。

| コマンド | 結果 |
|---|---|
| `npm test` | 153 pass / 0 fail / 0 skipped（追加の `test/coverage.test.mjs` 15 件を含む） |
| `npm run lint` | 成功。249 files scanned |
| `npm run test:smoke` | 成功（exit 0） |
| `node scripts/bench-coverage.mjs 1000 3` | 下表 |

`docs/workflow.md` のコマンド例は、fixture（`test/fixtures/coverage/repo`）を git 管理外へコピーして手で実行し、記載した行が出力に含まれること、終了コードが既定 0・`--strict` 1 であることを確認した。同じ照合を `test/coverage.test.mjs` でも行う。

### 1,000 change 規模の所要時間

合成 fixture は archive 済み change 1,000 件、各 change に Requirement 1 件・シナリオ 3 件・TP 3 件、capability 50 個（2 階層）、main spec のシナリオ 3,000 件である。結果 JSON は 3,000 テスト。`testkit-gate.mjs coverage` をプロセス起動込みで 3 回ずつ測った。

| 計測 | 最小 | 最大 |
|---|---|---|
| `coverage` | 534 ms | 974 ms |
| `coverage --results`（3,000 テスト） | 739 ms | 765 ms |

### 未計測

| 項目 | 理由 |
|---|---|
| Node 20 / 22 での実行 | このホストの Node は v26.2.0 だけで計測した |
| Linux と hosted GitHub Actions での `regression-command` | workflow の入力は `ci-job.mjs` の local harness（`test/coverage.test.mjs`）でだけ確認した |
| 実プロジェクトの archive に対する対応表 | fixture と合成 fixture だけで確認した |

## PR #6 再レビュー修正

記録日: 2026-10-06 JST。ホストは Darwin、Node v26.2.0。

| コマンド | 結果 |
|---|---|
| `npm test` | 180 pass / 0 fail / 0 skipped。再レビュー向け 11 テストを追加 |
| `npm run lint` | 成功。250 files scanned |
| `npm run test:smoke` | 成功（exit 0） |
| `node payload/scripts/testkit-gate.mjs coverage --format json` | このリポジトリで exit 0、対応不明・旧形式対応不明とも 0 件。spec-driven archive の test-plan 欠落を誤診断しない |
| `git diff --check` | 成功 |

最初の sandbox 内実行では npm キャッシュ書き込みと Chromium の起動が拒否された。上の全テスト・smoke の成功は sandbox 外で再実行した結果である。hosted GitHub Actions はこの記録には含めない。

回帰テストは、schema ごとの plan 欠落診断、壊れた進行中 change の個別警告と CI 継続、不正 TP-ID・対象外行・spec 見出し・MODIFIED 名の大小文字違い、fail → pass を含む順序非依存の結果合成、複数 TP の合成、未知 schema の警告、strict の真偽値、内部例外の再送出、coverage 保存失敗後の summary/risk 出力、E2E JSON エラーの CI ログを確認する。main spec と archive 済み change の文書も同じ挙動へ合わせた。
