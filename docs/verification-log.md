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
