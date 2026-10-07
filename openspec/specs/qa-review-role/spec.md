# qa-review-role Specification

## Purpose
QA エンジニアのテスト設計の知見を quality.md の承認時に一度だけ取り込み、後工程の手動テストを減らす。あわせて、承認・seal・反証・QA レビュー・手動確認に人間が使った時間を記録・集計し、工数が実際に減ったのか、別の役割へ移っただけなのかを判断できるようにする。

## Requirements

### Requirement: QA reviewer role in the quality policy

配布する `quality-policy.md` は、人間の役割を quality.md 承認者・Oracle seal 実施者・QA レビュー担当・コードレビュー担当に分けて定義しなければならない（MUST）。QA レビュー担当の責務は、承認前の quality.md と specs のシナリオをテスト設計の観点で確認することとする。policy は QA レビューを必須にする Risk Level を `qa_review_required_levels` で設定できなければならない（MUST）。この設定は、統合 schema が全 Risk で要求する人間承認・Oracle seal・独立反証を外したり弱めたりしてはならない（MUST NOT）。

#### Scenario: Policy defines distinct human roles
- **WHEN** 利用者が kit を導入して `openspec/quality-policy.md` を開く
- **THEN** 役割表に QA レビュー担当が quality.md 承認者と別の行として定義され、責務と確認のタイミング（quality.md 承認前）が書かれている

#### Scenario: QA setting cannot weaken integrated gates
- **WHEN** policy で `qa_review_required_levels` を空にした統合 change で、low Risk の quality.md が未承認または未 seal である
- **THEN** QA レビューは要求されないが、承認と seal の欠落は従来どおり失敗する

#### Scenario: Invalid QA level setting
- **WHEN** `qa_review_required_levels` に high / medium / low 以外の値がある
- **THEN** doctor と統合 change を検査する gate は設定不正として失敗し、QA レビュー不要とは扱わない

### Requirement: Human-only QA review record before seal

統合 schema の quality.md frontmatter は `qa_reviewed_by` と `qa_reviewed_at`（YYYY-MM-DD）を持たなければならない（MUST）。これらは人間だけが記入する欄であり、schema の instruction と role 定義は Agent による記入を禁止しなければならない（MUST）。change の risk_level が `qa_review_required_levels` に含まれるとき、`scripts/qe-gate.sh seal` と final gate は QA レビュー欄の欠落または日付不正を失敗としなければならない（MUST）。plan gate も承認欄が記入済み、またはタスクが一つでも完了していれば欠落を失敗としなければならない（MUST）。未承認・未着手の plan で両欄が空の場合だけは警告に留める。片方だけの記入や日付不正は plan でも失敗としなければならない（MUST）。gate と seal は有効な両日付があるとき `qa_reviewed_at <= approved_at` を検査し、逆順なら失敗としなければならない（MUST）。同日は許容し、同日の作業順序や実際の記入時刻は検証しない。QA レビュー欄の追加は `oracle_digest` の計算対象を変えてはならない（MUST NOT）。

#### Scenario: Seal is blocked without required QA review
- **WHEN** policy が medium を QA レビュー必須とし、risk_level が medium の quality.md に `qa_reviewed_by` が空のまま seal を実行する
- **THEN** seal は digest を書き込まずに失敗し、QA レビューが必要な理由を表示する

#### Scenario: Unapproved untouched plan waits for QA review
- **WHEN** QA 必須の change が未承認・未着手の plan で、QA レビュー欄が両方空である
- **THEN** plan gate は欠落を警告に留める

#### Scenario: Approved plan cannot omit QA review
- **WHEN** QA 必須の change が承認済みで、タスクが一つも完了していなくても QA レビュー欄が空である
- **THEN** plan gate は QA レビュー欠落で失敗する

#### Scenario: QA review date must not follow approval
- **WHEN** QA 必須の change で QA レビュー日が承認日より後である
- **THEN** plan / final gate と seal は日付順序を理由に失敗し、seal は digest を書き込まない。承認日以前（同日を含む）なら順序検査は成功する

#### Scenario: QA review not required for the level
- **WHEN** policy が high だけを QA レビュー必須とし、risk_level が low の change に QA レビュー欄が空である
- **THEN** gate は QA レビュー欠落で失敗せず、その他の人間ゲートだけを検査する

#### Scenario: Existing sealed change keeps its digest
- **WHEN** 既に seal 済みの統合 change の quality.md に、空の QA レビュー欄だけを追加する
- **THEN** `oracle_digest` は一致したままで、再 seal を要求しない

#### Scenario: Legacy schemas are unaffected
- **WHEN** 旧 `quality-driven` または `spec-driven-e2e` の change に QA レビュー欄が無い
- **THEN** gate は QA レビュー欄を要求しない

### Requirement: Test design checklist for QA review

kit は QA レビュー用の role 定義 `openspec/roles/qa-reviewer.md` を配布しなければならない（MUST）。この定義は、同値分割・境界値・デシジョンテーブル・状態遷移・エラー推測など、テスト設計技法ごとの確認観点と、確認結果を quality.md の Failure Modes や Test Oracles への修正提案として返す方法を含まなければならない（MUST）。QA レビュー担当は quality.md の期待値を自分で確定してはならず、修正は承認者の承認を経なければならない（MUST）。

#### Scenario: Checklist covers design techniques
- **WHEN** QA レビュー担当が `openspec/roles/qa-reviewer.md` を開く
- **THEN** 技法ごとに「specs のシナリオと Failure Modes で何が抜けていれば指摘するか」が列挙され、該当しない技法は理由を書いて省略する手順がある

#### Scenario: Review finding changes the quality contract
- **WHEN** QA レビューで不足している境界値が見つかる
- **THEN** 指摘は Failure Mode と Oracle の追加提案として返り、quality.md の承認欄と QA レビュー欄は人間が改めて記入する

### Requirement: Optional human effort records

統合 schema の evidence.md の Execution Records は、任意の `effort` 配列を持てなければならない（MUST）。各要素は活動種別（`approval`、`seal`、`qa-review`、`falsification-review`、`code-review`、`manual-test`、`other`）、所要分、記入者を持つ。gate は `effort` が無いことを失敗としてはならない（MUST NOT）。`effort` があるときは、未知の活動種別、負数・非数値の所要分、記入者の欠落を構造エラーとしなければならない（MUST）。所要分は人間が記入し、Agent は推測で埋めてはならない（MUST NOT）。

#### Scenario: Evidence without effort
- **WHEN** final gate が `effort` を持たない evidence.md を検査する
- **THEN** 工数記録の欠落だけでは失敗せず、他の証跡検査の結果で判定する

#### Scenario: Malformed effort entry
- **WHEN** `effort` に所要分が `-5` の要素、または活動種別が `testing` の要素がある
- **THEN** evidence の構造検査はその要素を指して失敗する

### Requirement: Effort aggregation across archived changes

kit は archive 済みの統合 change の evidence.md から `effort` を集計するコマンド（`node scripts/testkit-gate.mjs effort`）を提供しなければならない（MUST）。集計は活動種別と risk_level ごとの合計分と件数を出し、`effort` を記録していない change は 0 分として合算せず「未記録」として別に数えなければならない（MUST）。期間で絞り込めなければならない（MUST）。evidence が破損している change は集計から黙って除外せず、件数と change id を表示しなければならない（MUST）。

#### Scenario: Unrecorded changes are not zero
- **WHEN** archive 済み change が 3 件あり、2 件だけが `effort` を持つ
- **THEN** 集計は 2 件分の合計と、未記録 1 件（change id 付き）を別々に表示し、平均を 3 件で割らない

#### Scenario: Activity shift is visible
- **WHEN** 集計対象の change に `qa-review` と `manual-test` と `code-review` の記録がある
- **THEN** 出力は活動種別ごとの合計分を並べ、QA の作業とレビュー担当の作業の比率を比べられる

#### Scenario: Broken evidence during aggregation
- **WHEN** 集計対象の 1 件で Execution Records の JSON が壊れている
- **THEN** コマンドはその change id を破損として報告し、終了コードで集計が不完全であることを示す

### Requirement: QA ownership example

配布する `CODEOWNERS.example` は、QA レビュー担当を割り当てる例を含まなければならない（MUST）。例は quality.md と test-plan.md と QA role 定義を QA 担当のレビュー対象にし、QA チーム単独の owner と Require review from Code Owners を併用すること、および frontmatter の記名本人や役割の別人性は検証しないことを注記しなければならない（MUST）。

#### Scenario: QA owners in the example
- **WHEN** 利用者が `.github/CODEOWNERS.example` を開く
- **THEN** `openspec/changes/*/quality.md` などに QA チームを割り当てる行と、Require review from Code Owners を有効にする注記がある
