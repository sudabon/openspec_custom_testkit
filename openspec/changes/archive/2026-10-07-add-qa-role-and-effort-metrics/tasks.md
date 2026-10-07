# Tasks

本リストは kit 自体を既存 `spec-driven` で実装するためのタスクである。各実装タスクは対応する失敗 fixture を先に用意して RED を確認し、外から観測できる振る舞いを GREEN にする。自動検証で使う承認・QA レビュー・seal は隔離 fixture 内のダミーだけとする。

## 1. 失敗ケースの準備

- [x] 1.1 spec の全 Scenario を `test/` の fixture とテスト名へ対応付ける表を作る。完了条件: qa-review-role の 6 requirement・15 scenario に対応漏れと重複がない。
- [x] 1.2 QA レビュー欄の有無・日付不正・必須レベル内外・policy 値不正・旧 schema・既存 seal 済み change の fixture を作り、gate のテストを追加する。完了条件: 未実装のため期待どおり RED になり、import 失敗だけの RED がない。
- [x] 1.3 `effort` の正常・欠落・不正値の evidence fixture と、archive 済み change 4 件（記録あり 2・なし 1・破損 1 を含む組合せ）の集計 fixture を作る。完了条件: 構造検査と集計のテストが RED になる。

## 2. Policy・テンプレート・role

- [x] 2.1 `quality-policy.md` の役割表を quality.md 承認者・seal 実施者・QA レビュー担当・コードレビュー担当に分け、`qa_review_required_levels: [medium, high]` と「Agent が変更してはいけないもの」への新欄を追加する。完了条件: 全 Risk 必須の承認・seal・反証の記述が変わっていないことを差分で確認する。
- [x] 2.2 統合 schema の quality template に `qa_reviewed_by` / `qa_reviewed_at` を追加し、quality / apply instruction に Agent の記入禁止と、必須レベルで未記入なら停止することを書く。完了条件: `openspec schema validate` が通り、旧 schema の template に変更がない。
- [x] 2.3 `openspec/roles/qa-reviewer.md` を作る。完了条件: 入力 allowlist、design.md と実装の除外、技法ごとの確認観点（同値分割・境界値・デシジョンテーブル・状態遷移・エラー推測・シナリオ網羅）、修正提案としての出力、承認欄の代筆禁止がレビューで確認できる。
- [x] 2.4 evidence template に任意の `effort` の記入例と活動種別の一覧、Agent が推測で埋めない注記を追加する。完了条件: template のままの evidence が「未実行」として扱われる既存の検査結果が変わらない。
- [x] 2.5 `CODEOWNERS.example` に QA 担当の割り当て行と注記を追加する。完了条件: quality.md・test-plan.md・qa-reviewer.md が QA チームの対象になり、本人確認の限界が注記されている。

## 3. Gate の実装

- [x] 3.1 `policy.mjs` で `qa_review_required_levels` を読み、欠落時の初期値と不正値の失敗を実装する。完了条件: 1.2 の policy 関連テストが GREEN で、doctor が初期値の適用を表示する。
- [x] 3.2 seal と plan / final gate に QA レビュー検査を追加する。完了条件: 1.2 のテストが GREEN、既存 seal 済み fixture の digest が一致し、旧 schema の golden case が変わらない。
- [x] 3.3 `evidence-check.mjs` に `effort` の構造検査を追加する。完了条件: 欠落は成功、不正値は要素を指して失敗する（1.3 の構造テストが GREEN）。

## 4. 集計コマンド

- [x] 4.1 `testkit-gate.mjs effort` を実装し、活動種別・risk_level ごとの合計分と件数、未記録件数と id、記録率、破損件数を出す。`--since` と `--format table|json` を受け付ける。完了条件: 1.3 の集計テストが GREEN で、未記録を平均の分母に入れず、破損があると非ゼロ終了する。
- [x] 4.2 対象を archive 済みの統合 schema の change に限定する。完了条件: active change と旧 schema の change を含む fixture で集計対象外になることをテストで確認する。

## 5. 文書と統合検証

- [x] 5.1 `docs/workflow.md` に QA レビューの手順とタイミング、`docs/migration.md` に段階的な有効化手順を書く。完了条件: 手順に従って fixture の medium change を QA レビュー → 承認 → seal まで進められることを手元で確認する。
- [x] 5.2 `npm test`、`npm run lint`、`npm run test:smoke`、`npm pack --dry-run` を実行する。完了条件: すべて成功し、pack 一覧に `payload/openspec/roles/qa-reviewer.md` が含まれる。
