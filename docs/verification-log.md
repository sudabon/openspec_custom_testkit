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

## PR #6 再レビュー修正（2183791 への指摘）

記録日: 2026-10-06 JST。必須修正・修正推奨・文書と spec の不整合を対象とし、「テスト（任意）」の 2 件は対象外。

| コマンド | 結果 |
|---|---|
| `node --test test/coverage.test.mjs` | 60 pass / 0 fail |
| `npm test` | 198 pass / 0 fail / 0 skipped |
| `node --test --test-name-pattern='later requirements invalidate' test/coverage.test.mjs` | 全体テスト後に追加した他層の宣言の回帰テスト 1 件が成功 |
| `npm run lint` | 成功。250 files scanned |
| `npm run test:smoke` | 成功（exit 0） |
| `node payload/scripts/testkit-gate.mjs coverage --format json` | exit 0。117 シナリオ、対応不明・旧形式対応不明・警告は各 0 件 |
| `git diff --check` | 成功 |

全体テストの初回は、配布テスト内の npm pack が sandbox の npm キャッシュ書き込み制限（EPERM）で失敗した。198 件の成功は、許可された sandbox 外での再実行結果。

見出しの階層・空白・コロンの不備、Scenaro の誤記、空・コメントのみ・解析エラー・アンカー付き config、config.yml と config.yaml の優先順、設定由来の警告のファイル名と重複排除、対象外見出しの誤記・重複・箇条書き、シナリオのない main Requirement との名前照合を検証した。I/O エラーは終了コード 2、内部例外はスタックトレース付きの 3 とし、strict が無効でも CI は失敗して coverage.md・summary.txt・risk_level を保存することを確認した。

## PR #6 再レビュー修正（c8ab260 への指摘）

記録日: 2026-10-06 JST。必須修正 2 件、修正推奨 3 件、不足テスト 4 項目を対応。

| コマンド | 結果 |
|---|---|
| `node --test test/coverage.test.mjs` | 76 pass / 0 fail |
| `npm test` | 214 pass / 0 fail / 0 skipped |
| `npm run lint` | 成功。250 files scanned |
| `npm run test:smoke` | 成功（exit 0） |
| `node payload/scripts/testkit-gate.mjs coverage --format json` | exit 0。117 シナリオ、対応不明・旧形式対応不明・警告は各 0 件 |
| `git diff --check` | 成功 |

全体テストと smoke の初回は sandbox による npm キャッシュ書き込み・Chromium 起動の制限で失敗した。上の成功結果は、許可された sandbox 外で再実行した結果である。

小見出し・コード例を含む test-plan の表、対象外のヘッダ行だけの表・箇条書き混在、ハッシュタグとインデントしたコードの誤検出、参照先のない YAML エイリアスの config / archive / WIP 別の扱いを検証した。結果照合・集計・Markdown / JSON 出力に例外を注入し、終了コード 3 と CI の summary / risk 出力を確認した。2 件目の空白なし Requirement 見出し、specs / archive がファイルの場合と openspec 不在の終了コード 2、小文字の独立 TP 参照の除外、main に無い過去 capability の名前を WIP の照合に持ち越さないことも固定した。

## PR #6 再レビュー修正（c481b50 への指摘）

記録日: 2026-10-06 JST。Critical・Important と不足テストを対応。

| コマンド | 結果 |
|---|---|
| `node --test test/coverage.test.mjs` | 86 pass / 0 fail |
| `npm test` | 224 pass / 0 fail / 0 skipped |
| `npm run lint` | 成功。250 files scanned |
| `npm run test:smoke` | 成功（exit 0） |
| `node payload/scripts/testkit-gate.mjs coverage --format json` | exit 0。118 シナリオ、対応不明・旧形式対応不明・警告は各 0 件 |
| `git diff --check` | 成功 |

全体テストの初回は、配布テスト内の npm pack が sandbox の npm キャッシュ書き込み制限（EPERM）で失敗した。224 件の成功は、許可された sandbox 外で再実行した結果である。

全角コロン・括弧の不正な見出し、インラインコードとフェンスの区別、未閉鎖フェンスの main / archive / WIP 別の診断、フェンス終了の記号・長さ・info 文字列、1〜3 空白付きの見出しを検証した。複数表の列順、説明用メモと箇条書き宣言の区別、インデントしたパイプ表の互換性、コード例内 TP-ID の除外も固定した。不正な config.yaml / config.yml はパス付きの終了コード 2 とし、CI が coverage.md・summary.txt・risk_level を保持することを確認した。内部エラーの各処理段階のテストは、グローバル関数の置換とスタック文字列による発火条件を、処理ごとの依存注入に置き換えた。

## add-nonfunctional-test-viewpoints

記録日: 2026-10-07 JST。Node v26.2.0、OpenSpec CLI 1.13.2。

| コマンド | 結果 |
|---|---|
| `npm test` | 278 pass / 0 fail |
| `npm run lint` | 成功。255 files scanned |
| `npm run test:smoke` | 成功（exit 0）。同梱 example の chromium / webkit / mobile-safari の3 project 実行を含む |
| `openspec validate add-nonfunctional-test-viewpoints --strict` | valid |
| `git diff --check` | 成功 |

観点表の欠落行、未知の F-ID、理由の無い「該当なし」、F-ID と理由の両方記入、`e2e: required` での「全観点」1行、不明・重複した観点名を負例として固定した。表の無い統合 change は、導入日より前の `created` で警告、`created` の欠落・不正、stamp の導入日の欠落、導入日以降の作成で失敗することを確認した。stamp の導入日は初回に記録され、同一内容の再実行で stamp が変わらず、旧 stamp からの update で既存項目が保持される。reporter は宣言 project の未実行で終了コード 1、fail で 3、全 project の pass で 0 を返し、`TP-002 (mobile-safari 未実行)` の形で欠落を表示する。既存の統合 quality fixture には観点表を追加した（表の無い fixture は fail closed の対象になるため）。

## add-e2e-result-publishing

記録日: 2026-10-07 JST。ホストは Darwin、Node v26.2.0。push、npm 公開、hosted GitHub Actions の実行はしていない。

| コマンド | 結果 |
|---|---|
| `npm test` | 333 pass / 0 fail / 0 skipped（追加の `test/publishing.test.mjs` 15 件と `test/workflow-publishing.test.mjs` 8 件を含む） |
| `npm run lint` | 成功。264 files scanned |
| `npm run test:smoke` | 成功（exit 0）。同梱 example config を `TESTKIT_RUN_DIR` 付きで実行し、添付が summary に相対パスで出ること、HTML レポートが実行 directory の配下に出ることを確認 |
| `npm pack --dry-run` | 成功。変更した payload・docs・examples が一覧に含まれる |
| `actionlint` v1.7.7（`go run`、`-shellcheck=`） | `openspec-custom-testkit-gate.yml` で指摘 0 件 |

workflow の公開系 step は local harness で確認した。保持日数の検証、リンクの追記、PR コメントの作成・更新・権限不足（fake `gh` で 403 を注入）を、workflow ファイルの `run` を bash（`-eo pipefail`）で実行して確かめた。ゲートと公開の成否の組み合わせは、`continue-on-error` と `if: always()` の配置から job の結論を計算して確かめた。

### 未実施

| 項目 | 理由 |
|---|---|
| hosted GitHub Actions での artifact 保存・artifact URL・step summary・PR コメント | 実 CI を実行していない。`actions/upload-artifact@v4` の `artifact-url` 出力と空の `retention-days` の扱いは、実 CI で未確認 |
| fork PR での権限不足 | 実 CI を実行していない。fake `gh` の 403 で代替した |
| shellcheck | ローカルに無いため、actionlint の shellcheck 連携を無効にした |

## PR #9 必須修正・修正推奨 8 件

記録日: 2026-10-07 JST。ホストは Darwin、Node v26.2.0。

| コマンド | 結果 |
|---|---|
| `npm test` | 340 pass / 0 fail / 0 skipped |
| `npm run lint` | 成功。265 files scanned |
| `npm run test:smoke` | 成功（exit 0）。同梱 example の Chromium 起動、HTML と添付の保存も確認 |

要約生成の両段階の例外、GITHUB_OUTPUT 書き込み失敗で終了コード 0 / 3 が保持されることを確認した。欠落・破損した入力の案内、回帰実行による E2E 成果物の上書き防止、早期終了時の理由と PR コメント用 summary_file の出力を local harness で検証した。workflow の run スクリプトを実行し、HTML の実ファイル確認と testkit-results のアップロード失敗が step summary・PR コメントに反映されることを確認した（GitHub API は fake gh）。

全体テストと smoke の初回実行は sandbox の npm キャッシュ書き込み制限・Chromium 起動制限で失敗したため、sandbox 外で再実行して成功した。実際の reusable workflow による artifact upload と PR コメント投稿は、このローカル検証には含めていない。
