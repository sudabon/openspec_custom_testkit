# Tasks

本リストは kit 自体を `spec-driven` で実装するためのタスクである。各タスクは対応する fixture のテストを先に RED にし、外から観測できる振る舞いを GREEN にする。未実行の検証はチェックしない。

## 1. レポータの summary 形式

- [x] 1.1 pass / fail / flaky / skip / 欠落 TP / 単一・複数 project / 添付あり・なし・公開対象外・body 添付の Playwright JSON fixture を `test/` に追加する。完了条件: summary 形式の期待出力に対するテストが、未実装のため assertion で RED になる（import 失敗だけの RED は不可）。
- [x] 1.2 `parseReporterArgs` に `--format text|summary` を追加し、不正値を終了コード 2 にする。完了条件: 既存の引数だけの呼び出しで、標準出力と終了コードが変更前の golden と一致するテストが通る。
- [x] 1.3 `buildReport` を、分類済みの行と描画に分け、summary 描画（TP-ID / テスト / project / 結果 / フレーク / 添付）を実装する。完了条件: 1.1 のテストが GREEN になり、同じ入力で text と summary の終了コードが一致する。
- [x] 1.4 添付の収集と相対パス化を実装する。完了条件: runner の絶対パスが出力に一切現れないこと、公開対象外と添付なしが区別されること、body 添付の中身が出ないことをテストで確認する。

## 2. ci-job と step summary

- [x] 2.1 `ci-job.mjs` が change ごとに `<change-id>.summary.md` を実行 directory に書き、`GITHUB_STEP_SUMMARY` があれば追記する。完了条件: local harness で summary ファイルと step summary の内容を確認できる。E2E を実行しない構成では「実行しなかった理由」だけが出る。
- [x] 2.2 step summary の書き込み失敗（書込不可パス）を注入する。完了条件: 警告行が出て、ci-job の終了コードは失敗を注入しない場合と同じになる。
- [x] 2.3 件数上限を超える fixture で、超過分が artifact 内の summary.md を参照する表示になる。完了条件: step summary の出力サイズが上限以下であることをテストで確認する。
- [x] 2.4 今回の実行 directory を `GITHUB_OUTPUT` の `run_dir` に出す。完了条件: 前回の実行 directory が残った状態でも、出力が今回の directory だけを指すテストが通る。

## 3. reusable workflow

- [x] 3.1 入力 `publish-pr-comment`（既定 false）と `artifact-retention-days` を追加し、保持期間の入力をゲートの前に検証する。完了条件: workflow 構文検査が通り、不正値（0、負数、文字列）で入力エラーになることを確認する。
- [x] 3.2 HTML レポート artifact と、artifact URL を step summary に追記する step を `if: always()` と `continue-on-error: true` で追加する。完了条件: ゲート失敗・成功の両方で artifact と link が出ることを、local harness または実 CI の記録で確認する。実 CI 未実行なら未実行と記録する。
- [x] 3.3 PR コメント step を、マーカー付きコメントの作成または更新で実装する。本文はファイル経由で渡す。完了条件: 権限不足のときに警告だけ出て job 結果が変わらないことを確認する。PR タイトルなどの非信頼文字列を shell に展開しないことをレビューで確認する。
- [x] 3.4 ゲート失敗 × 公開成功、ゲート成功 × 公開失敗、の組み合わせを注入する。完了条件: 最終 job の結果がゲートの結果だけで決まることを確認する（`ci-distribution-contract` の Preserve CI failures と一致）。

## 4. 配布物と文書

- [x] 4.1 `playwright.config.example.ts` に、`outputDir` と HTML reporter を `TESTKIT_RUN_DIR` の配下へ出す設定を追加する。完了条件: smoke で添付が summary に相対パスとして出る。
- [x] 4.2 `examples/ci/README.md` と `docs/workflow.md` に、summary の読み方、PR コメントの権限、保持期間、添付の機微情報の注意を書く。完了条件: 文書に「kit が中身を検査した」と読める記述がないことをレビューで確認する。
- [x] 4.3 `npm test`、`npm run lint`、`npm run test:smoke`、`npm pack --dry-run` を実行する。完了条件: すべて成功し、追加ファイルが pack 一覧に含まれる。
