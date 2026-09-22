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
