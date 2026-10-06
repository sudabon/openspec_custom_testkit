# Design

## Context

動機は proposal.md の Why を参照する。現状、QA に渡せる情報は evidence.md（機械照合用の JSON が中心）と quality.md の Residual Risk だけである。final gate の検査は `payload/scripts/lib/evaluate.mjs` の `effectivePhase`（archive・削除・全タスク完了で final）と、`evidence-check.mjs` の `checkEvidence` で行う。`change.lifecycle` は archived / active / deleted を区別できるので、archive 時だけの必須項目を追加できる。

## Goals / Non-Goals

**Goals:**

- QA が自動化済みの範囲を確認し直さずに済む根拠を、evidence の実行結果から作る。
- 自動化しないと判断した範囲を、理由付きで計画の段階に出す。
- 人間専用の欄を、既存の承認欄と同じ考え方で扱う。

**Non-Goals:**

- QA 実施者の本人確認や、改ざんできない署名の仕組み。
- 探索テストの実行支援ツールや、テスト管理システムとの連携。
- QA 工数の計測（`add-qa-role-and-effort-metrics` で扱う）。

## Decisions

### 1. Manual を Test Layer の一つにする

Residual Risk だけで手動範囲を表す案は採用しない。Residual は「保証しないことの受容」であり、計画の段階で「人が見る」と決めた範囲とは意味が違うためである。別の表を新設する案も採用しない。Failure Mode から層への割当が一か所に集まらず、未割当を検出しにくいためである。Layer の候補に `Manual` を加え、理由を必須にする。plan-check の E2E 層検出は `E2E` の語で判定しているので、`Manual` が E2E とみなされないことを回帰テストで固定する。

### 2. qa-handoff.md は apply の依存にしない

evidence と同じく、実行後でなければ中身が決まらない。schema の artifact として依存グラフに入れると apply が ready にならないので、テンプレートだけを配布し、tasks の最終グループで作る。テンプレートは表形式にする。

- 自動化済み範囲: Risk / Failure Mode / Oracle / Layer / TP-ID / Run-ID
- 手動確認範囲: ID / 種別（Manual・Residual）/ 確認観点 / 理由
- 探索チャーター: Charter-ID / 目的 / 対象 / 時間の目安
- QA 実施結果: 実施者 / 実施日 / 判定 / 所見

ゲートは表を `parseTable` で読み、ID の突合をする。

### 3. 必要条件は Manual・quality の Residual・evidence の residuals のどれか

Manual 層だけを条件にすると、反証で見つかった反例を Residual として承認した場合に、QA へ伝わらない。そのため3つのどれかに当てはまれば必須にする。結果として、Residual を書く change はほぼすべて handoff を要求される。QA へ伝えるべき情報があるという意味でこれは意図どおりだが、移行時に既存 change が失敗しうるので、`docs/migration.md` に書く。

### 3a. quality.md の Residual には ID を付ける

手動確認範囲と ID で突合するため、quality.md の Residual Risk の各項目は `- RR1: <内容>` の形式にする。handoff が必要な change で ID の無い項目があれば final で失敗する。空の箇条書きと `なし` / `該当なし` / `None` は Residual なしとみなす。表に変える案は、既存の箇条書きをすべて書き換えることになるので採用しない。

### 4. QA 実施結果は archive で必須、final では警告

final は全タスク完了の時点で走り、CI 上では QA の実施前であることが多い。final で必須にすると「QA を待つために PR を止める」か「Agent に空欄を埋めさせる」誘因になり、後者は人間専用欄の原則に反する。archive は change を閉じる操作なので、ここで実施者・日付・判定を必須にする。判定 `fail` での archive は失敗にする。修正するか、Residual として人間が承認し直すまで閉じさせない。

### 5. 記入例の残りを検出する

テンプレートの記入例は `<!-- example -->` の印を付けた行にする。ゲートはこの印のある行と空のセルを未記入とみなす。文字列の一致で判定すると、利用者の言語設定やテンプレート更新で壊れやすいためである。

## Risks / Trade-offs

- [Residual があると常に handoff が要る] → 小さな change では負担になる。不要なら Residual を書かないのが正しい運用であると workflow 文書に書く。
- [QA 判定欄を Agent が埋める] → instruction と role で禁止する。保証は CODEOWNERS とブランチ保護に依存し、kit は本人確認をしないことを明記する。
- [自動化済み範囲を過大に見せる] → `pass` の risk_results だけを根拠にし、run が `unverified` の場合は handoff にその旨を表示する。

## Migration Plan

`update` で新しいテンプレートと schema を配布する。既存の統合 change のうち Residual があるものは、次の final で handoff を求められる。`docs/migration.md` に、作り方と、archive 時に QA 判定が必要になることを書く。旧 schema は変更しない。
