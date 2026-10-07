# QA reviewer

製品に依存しない役割です。QA レビュー担当（人間の QA エンジニア）が、quality.md の承認前に一度だけ、テスト設計の観点で quality.md と specs のシナリオを確認するためのチェックリストです。Agent の adapter は置きません。

QA レビューを必須にする Risk Level は `openspec/quality-policy.md` の `qa_review_required_levels` で決まります（行が無ければ `[medium, high]`）。必須でない Level でも、このチェックリストを使ってかまいません。

## 入力してよいもの

- 対象 change の `specs/**/*.md`
- 対象 change の `quality.md`
- 対象 change の `test-plan.md`（あれば）
- `openspec/quality-policy.md`
- この role 定義

## 入力してはいけないもの

- `design.md`
- 実装本体と実装の差分
- 実装エージェントの会話、コミットメッセージ

期待値が実装の都合に引きずられないようにするためです。Oracle writer と同じ理由です。

## 手順

1. specs の Requirement と Scenario を読み、quality.md の Risk Register、Failure Modes、Test Oracles、Test Layer Mapping と突き合わせる。
2. 次の「技法ごとの確認観点」を上から順に当てはめる。技法ごとに、指摘があるか、指摘なしか、該当しない技法かを決める。
3. 該当しない技法は、省略する理由を1行で書いて省略する（例: 「状態遷移: 状態を持たない計算だけの change のため該当しない」）。理由なしに省略しない。
4. 指摘を「出力」の形で quality.md の作成者と承認者に返す。
5. 指摘への対応（quality.md の修正、または対応しない理由）を確認したら、`qa_reviewed_by` と `qa_reviewed_at`（YYYY-MM-DD）を記入する。

## 技法ごとの確認観点

各技法で「specs のシナリオと Failure Modes に何が抜けていれば指摘するか」を示します。

### 同値分割

- 入力・状態ごとの有効クラスと無効クラスが Failure Modes か Scenario に現れているか。有効クラスしか無い場合は指摘する。
- 同じクラスの代表値が複数の Oracle に重複し、別のクラスが一つも無い場合は指摘する。

### 境界値

- 数値・長さ・件数・日付・金額の上限と下限、その直前と直後（例: 0 / 1 / 最大値 / 最大値+1）が Failure Mode か Oracle にあるか。
- 空・null・未定義、桁あふれ、丸めと精度、タイムゾーンや月末・閏日の境界が抜けていれば指摘する。

### デシジョンテーブル（条件の組合せ）

- 結果を変える条件が2つ以上ある Requirement で、条件の組合せごとの期待結果が Scenario か Oracle で決まっているか。
- 組合せの一部（とくに「両方偽」や優先順位がぶつかる組合せ）の期待結果が書かれていなければ指摘する。

### 状態遷移（不正遷移を含む）

- 状態を持つ対象で、正規の遷移と、許されない遷移（取消済みからの再実行、二重送信、戻る操作など）の期待結果があるか。
- 不正遷移が拒否されること、拒否後に状態が変わらないことを観測する Oracle が無ければ指摘する。

### エラー推測

- 外部依存の失敗・タイムアウト、再試行と冪等性、並行実行、権限不足、過去の障害や類似機能で起きた不具合に相当する Failure Mode があるか。
- 「エラーが出ない」だけを観測する弱い Oracle は指摘する。

### ユースケース／シナリオの網羅

- specs の各 Scenario が、いずれかの Failure Mode か Oracle に対応しているか。対応の無い Scenario を指摘する。
- 利用者の業務の流れとして、開始から完了までの主要な経路と、途中でやめる・やり直す経路が Scenario にあるか。
- Manual 層を選んだ Failure Mode の理由が「自動化できない」ことを説明しているか。

### 関連する観点一覧

- 非機能の観点（表示環境・見た目・アクセシビリティ・文言・性能・入力系セキュリティ）は quality.md の `## Non-functional Viewpoints` 表で確認する。該当なし理由が具体的でなければ指摘する。
- 既存機能への影響は、`node scripts/testkit-gate.mjs coverage` のシナリオ対応表で、変更する capability の既存シナリオが保護されているかを確認する。回帰の観点が抜けていれば指摘する。

## 出力

- 指摘は quality.md への修正提案として返す。形式は「追加・修正すべき Failure Mode（Risk との対応、観点）」と「それを観測する Test Oracle（観測点と期待状態）」の組にする。specs の Scenario が足りない場合は、Scenario の追加提案として返す。
- 技法ごとの確認結果（指摘あり・指摘なし・該当しない理由）の一覧。
- 提案を quality.md に反映するかは作成者と承認者が決める。反映した場合、quality.md の承認者が `approved_by` / `approved_at` を改めて記入し、QA レビュー担当も確認後に `qa_reviewed_by` / `qa_reviewed_at` を改めて記入する。

## 禁止

- QA レビュー担当が quality.md の期待値を確定すること。修正は承認者の承認を経る
- `approved_by`、`approved_at`、`oracle_digest` の記入、`scripts/qe-gate.sh seal` の実行（それぞれ承認者と seal 実施者の役割）
- Agent に `qa_reviewed_by` / `qa_reviewed_at` を代筆させること。Agent はこの欄を記入しない
- design.md や実装を読んで期待値を決めること

kit は記入者の本人確認をしません。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存します。
