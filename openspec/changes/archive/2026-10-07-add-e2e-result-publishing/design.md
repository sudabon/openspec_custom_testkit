# Design

## Context

動機は proposal.md の Why を参照する。2026-10-05 時点の実装は次のとおり。

- `payload/scripts/lib/report.mjs` の `buildReport` が、TP-ID・テスト名・結果・フレークの Markdown 表を標準出力に出す。project 名は複数 project のときだけテスト名に付く。attachments は読んでいない。
- `payload/scripts/ci-job.mjs` は、E2E の結果を `test-results/testkit/<run>/results.json` に保存する。change ごとの `<change-id>.report.txt`、manifest、`summary.txt` も書く。
- `.github/workflows/openspec-custom-testkit-gate.yml` は `if: always()` で `test-results/testkit/` を artifact `testkit-results` として保存する。step summary、HTML レポート、PR コメントはない。
- 既存 spec `ci-distribution-contract` の「Preserve CI failures and trusted command inputs」が、保存処理後も失敗を伝えることと、非信頼文字列を shell に展開しないことを求めている。本 change はこれを前提にする。

## Goals / Non-Goals

**Goals:**

- PR の Checks 画面だけで、TP ごとの結果と失敗の根拠（trace / screenshot / video）に辿り着ける。
- 公開処理を追加しても、ゲートの判定、終了コード、既存の呼び出し形式が変わらない。

**Non-Goals:**

- 実行をまたいだ履歴やフレーク率の集計（`add-flaky-management` の範囲、または将来の検討）
- 添付のマスキングや自動削除
- GitHub 以外の CI 向けの公開アダプタ
- evidence.md の書式変更

## Decisions

### 1. summary はレポータの出力形式として追加する

`buildReport` が既に持つ分類（`flatten` と coverage 判定）を、そのまま使う。別スクリプトで Playwright JSON を読み直す案は採用しない。分類が二重になり、表示と判定がずれるためである。

`parseReporterArgs` に `--format <text|summary>`（既定 `text`）を追加する。`buildReport` は分類済みの行を返す。text と summary は、同じ行から描画する。終了コードは描画の前に決める。

summary の列は TP-ID / テスト / project / 結果 / フレーク / 添付 とする。project は単一 project でも必ず出す。表の前に実行開始時刻、所要時間、件数、欠落 TP-ID を置く。

### 2. 添付は相対パスだけを出す

Playwright JSON の `results[].attachments[]`（`name`、`contentType`、`path`）を、最後の attempt と、失敗した attempt から集める。`path` が公開 root（既定は実行 directory、例 `test-results/testkit/<run>/`）の配下にあれば相対パスにし、配下になければ「公開対象外」と示す。base64 の `body` 添付は名前だけを示し、中身は出さない。

`playwright.config.example.ts` の `outputDir` と HTML reporter の出力先を、`TESTKIT_RUN_DIR` の配下へ寄せる例を示す。これで、添付と HTML レポートが今回の実行の artifact に入る。利用者が独自の config を使うときは「公開対象外」と表示されるだけで、ゲートには影響しない。

### 3. step summary は ci-job が書き、workflow は artifact とリンクを担当する

`ci-job.mjs` は change ごとに `<change-id>.summary.md` を実行 directory に書く。`GITHUB_STEP_SUMMARY` があればそこへも追記する。追記の失敗は警告行を足すだけにし、`code` を変えない。

workflow 側の変更:

- 既存の `Save run artifacts`（`testkit-results`）は維持する。
- HTML レポートの artifact `testkit-playwright-report` を `if: always()` で追加する。
- `actions/upload-artifact@v4` の出力 `artifact-url` を使い、後続 step でリンクを step summary に追記する。

前回の実行の directory を拾わないよう、ci-job が今回の実行 directory を `GITHUB_OUTPUT` の `run_dir` として渡し、upload はそれだけを対象にする。

### 4. PR コメントは任意入力で既定オフ、失敗しても警告

- 入力 `publish-pr-comment`（boolean、既定 `false`）を追加する。有効時は、`<!-- openspec-custom-testkit -->` マーカー付きのコメントを 1 件だけ更新する。投稿には `gh api` を使い、本文はファイル経由で渡す。PR タイトルなどを shell に展開しない。
- 投稿 step は `continue-on-error: true` とする。権限不足（403）や fork PR は `::warning::` に出す。
- reusable workflow 内で `permissions` を引き上げることはしない。必要な `pull-requests: write` は呼び出し側が付けることを README に書く。

採用しなかった案:

- 既定オン：fork PR で毎回警告になり、権限を要求する。
- 権限不足を失敗扱いにする：公開の都合でゲートが落ち、既存の判定と食い違う。

### 5. 公開とゲートの終了コードを分ける

公開系の step は、ゲート step の後に `if: always()` で置く。ゲート step の終了コードは GitHub Actions の job 結果としてそのまま残り、公開 step は `continue-on-error` で job 結果を変えない。

ただし `artifact-retention-days` の検証は、入力エラーとしてゲートの前に行い、非ゼロで止める。不正な入力を黙って既定値にすると、意図しない保持期間で機微な添付が残るためである。

### 6. 機微情報と保持期間

- 入力 `artifact-retention-days`（空なら GitHub の既定）を、すべての公開 artifact に適用する。
- `examples/ci/README.md` と `docs/workflow.md` に、次の注意を書く。
  - screenshot、video、trace に、個人情報、トークン、内部 URL が写りうる。
  - private リポジトリでも artifact は閲覧権限のある全員が見られる。
  - テストデータには合成データを使う。
- kit が中身を検査した、と表示する文言は入れない。

## Risks / Trade-offs

- [リスク] 利用者の Playwright config が添付を実行 directory の外に出す → 「公開対象外」と表示して可視化し、example config で寄せ方を示す。
- [リスク] step summary の容量上限（1MiB）を超える大規模 suite → change ごとに件数上限を設け、超過分は artifact 内の summary.md を参照させる。
- [リスク] artifact を増やすことでストレージ費用が増える → 保持期間の入力と、HTML レポートを E2E 実行時だけ保存することで抑える。
- [トレードオフ] PR コメントの既定がオフなので、Checks 画面まで見に行く必要がある → step summary を一次情報にし、コメントは任意の補助にする。

## Migration Plan

新しい入力はすべて任意で、既定では従来と同じ判定になる。既存の呼び出し側は変更なしで step summary と HTML artifact が増える。戻すときは workflow の版を戻すだけでよい。

## Open Questions

- step summary の件数上限の具体値（例: change あたり 200 行）は、実装時の smoke の規模で決める。上限値を変えても spec の振る舞い（超過分を artifact で参照させる）は変わらない。
