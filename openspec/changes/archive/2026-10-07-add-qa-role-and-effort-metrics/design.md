# Design

## Context

動機は proposal.md の Why を参照する。現状の観測結果は次のとおり。

- `quality-policy.md` の役割表は「正しさの定義＝人間」の 1 行で、QA の関与を定義していない。
- `oracle_digest` は `scripts/lib/digest.mjs` の `manifestDigest` が `oracle_paths` 配下のファイルだけから計算する。quality.md 自体は digest に含まれない。
- 承認の検査は `scripts/lib/evaluate.mjs`（`approved_by` / `approved_at`）と `scripts/qe-gate.mjs` の seal 前検査にある。
- evidence の `reviews[]` は `scripts/lib/evidence-check.mjs` で medium 以上の `reviewer` と high の `includes_domain_owner` だけを検査している。evidence は実装後に作るため、ここに記録した内容は seal 前のゲートに使えない。

## Goals / Non-Goals

**Goals:**

- QA レビューを quality.md の承認前に一度だけ行う工程として定義し、必要な Risk Level では seal 前に機械的に確認する。
- QA レビューの観点をテスト設計技法の形で配布し、レビューの品質を担当者の経験に依存させない。
- 人間の検証工数を活動ごとに記録・集計し、工数の移動を観測できるようにする。

**Non-Goals:**

- 統合 schema の全 Risk 必須の人間承認・seal・独立反証を変更すること。
- QA 担当者の本人確認や、承認者と QA 担当が別人であることの強制（CODEOWNERS とブランチ保護に委ねる）。
- 導入前の手動テスト工数との自動比較や、外部工数管理ツールとの連携。
- 工数記録の必須化。

## Decisions

### 1. QA レビューの記録先は quality.md frontmatter

| 案 | 長所 | 短所 |
|---|---|---|
| A. quality.md frontmatter に `qa_reviewed_by` / `qa_reviewed_at` | seal 前に検査できる。承認欄と同じ保護・同じ記入規則で扱える | 欄が増える。旧 change との互換を考える必要がある |
| B. evidence の `reviews[]` に `role: qa` | 既存の reviews 検査を拡張するだけで済む | evidence は実装後に作るため、承認前に QA が見たことを seal 時点で確認できない。工程の目的（実装前に観点を入れる）と合わない |
| C. 別ファイル `qa-review.md` | 指摘内容を詳しく残せる | artifact が増え、schema の依存グラフと digest 対象を変える必要がある |

A を採用する。QA レビューの価値は実装前に Failure Modes と Oracle へ観点を入れることにあり、seal 前に検査できない B は目的を満たさない。digest は `oracle_paths` 配下だけを対象にするため、欄を足しても既存の seal は無効にならない。指摘の中身は quality.md 自体の修正として残るので、C の別ファイルは作らない。evidence の `reviews[]` に `role: qa` を書くことは妨げないが、必須条件には使わない。

新欄は `approved_by` 等と同じく「Agent が変更してはいけないもの」に加え、schema の quality / apply instruction と roles に記入禁止を明記する。

### 2. 必須レベルは policy の `qa_review_required_levels`

既存の `mutation_threshold_high` と同じく、policy の機械可読な行（例: `qa_review_required_levels: [medium, high]`）として `scripts/lib/policy.mjs` で読む。配布する初期値は `[medium, high]` とする。low まで含めると表示・文言だけの変更にも QA 待ちが発生し、工数削減の目的に反するため。

環境変数での上書きは提供しない。`QE_SEAL_REQUIRED_LEVELS` のように環境変数で条件を外せると、CI 設定だけでゲートを外せてしまうためである。値の不正は「不要」とみなさず失敗にする（fail closed）。

### 3. 旧 schema と既存 change の扱い

QA レビューの検査は統合 schema の change だけに適用する。欄が無い既存の統合 change は、risk_level が必須レベルに含まれる場合だけ失敗する。導入直後に進行中の medium / high change が一斉に止まるのを避けるため、`docs/migration.md` に「更新前に policy を `[]` にしてから段階的に有効化する」手順を書く。policy の変更は CODEOWNERS の保護対象なので、外すこと自体が人間のレビューを通る。

### 4. チェックリストは roles に置く

`openspec/roles/qa-reviewer.md` として、既存の oracle-writer / falsifier と同じ「入力してよいもの・してはいけないもの・出力・禁止」の形で書く。policy に置く案は、policy が組織ごとに書き換えられる前提のため、技法の説明が上書きで失われやすい。roles は製品非依存の役割定義なので技法の一覧に向いている。入力は specs、quality.md、test-plan.md、quality-policy.md に限り、design.md と実装は渡さない（期待値が実装に引きずられないようにするため。Oracle writer と同じ理由）。

技法ごとの確認観点は次を最低限とする: 同値分割、境界値、デシジョンテーブル（条件の組合せ）、状態遷移（不正遷移を含む）、エラー推測、ユースケース／シナリオの網羅。`add-nonfunctional-test-viewpoints` と `add-regression-coverage-map` が archive 済みなら、その観点一覧と対応表を参照する一文を入れる。

### 5. 工数記録は任意、集計は「未記録」を分ける

`effort` を必須にすると、記入の手間そのものが工数を増やし、埋めるための推測値が混ざる。任意にする代わりに、集計で「記録率」を出す。未記入を 0 分にすると平均が下がり「工数が減った」と誤読されるため、未記録の change は件数と id だけを出し、合計・平均の分母に入れない。

活動種別は固定の列挙にする（自由記述だと集計できない）。`manual-test` は `add-qa-handoff` の Manual 層の実施時間を記録する先として使う。

集計コマンドは既存の `testkit-gate.mjs` のサブコマンドにし、`--since YYYY-MM-DD` と `--format table|json` を受け付ける。対象は `openspec/changes/archive/` の統合 schema の change に限る。

## Risks / Trade-offs

- [QA レビューが待ち行列になり、リードタイムが延びる] → 初期値を medium 以上にし、集計で `qa-review` の所要分と件数を観測できるようにする。
- [承認者と QA 担当が同一人物になり形骸化する] → 本 change では強制しない。CODEOWNERS.example で別チームを割り当てる例を示し、限界を docs に書く。
- [工数記録が少なく集計が当てにならない] → 記録率を必ず表示し、少ない場合はその旨を出力する。
- [frontmatter 欄の追加で既存の解析が壊れる] → 既存 fixture に欄あり／なしの両方を足し、旧 schema の golden を維持する。

## Migration Plan

1. kit の update で policy・template・roles・gate を更新する。既存 policy に `qa_review_required_levels` が無い場合は、統合 schema では初期値 `[medium, high]` として扱い、doctor がその旨を表示する。
2. 進行中の medium / high change があるチームは、`docs/migration.md` の手順で一時的に `[]` に設定し、各 change の QA レビュー後に戻す。
3. ロールバックは kit の旧版への update で行う。追加した frontmatter 欄は旧版の gate では無視される。
