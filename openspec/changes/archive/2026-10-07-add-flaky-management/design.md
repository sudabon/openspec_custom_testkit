# Design

## Context

背景は proposal.md の Why を参照する。現在の reporter（`payload/scripts/lib/report.mjs`）は Playwright の `flaky` を `pass` として coverage に入れ、表に ⚠ を出すだけである。TP の Risk は test-plan の `Risk` 列にあり、Level は quality.md の Risk Register にある。両方とも plan-check がすでに読んでいる（`tpRows` と `qualityModel`）。policy は `mutation_threshold_high:` のように、Markdown 中の機械可読の行で値を読んでいる（`policy.mjs`）。

## Goals / Non-Goals

**Goals:**

- Risk が高い TP のフレークを、policy の指定で不合格にできる。
- 壊れたテストを、期限・担当・代替検証つきで外せる。外している間も、その TP が自動では守られていないことを隠さない。
- 方針を書いていない利用者と旧 schema の挙動を変えない。

**Non-Goals:**

- 実行をまたいだフレーク率の蓄積。CI の artifact、リポジトリへの commit、外部ストアのどこに履歴を置くかで、権限と改ざん耐性の要件が変わる。今回は 1 回の実行の分類に限り、後続の change で扱う。
- フレークの検出に基づく自動隔離と自動解除。人間の判断を経ずに coverage を外すことになるので行わない。
- `retries` の既定値の変更。利用者の Playwright 設定は保護ファイルである。

## Decisions

### 1. フレーク方針は Level の集合で指定する

`flaky_fail_levels: [high]` や `flaky_fail_levels: [medium, high]` のような 1 行（`qa_review_required_levels` と同じリスト形式）を policy に置く。Level ごとの表の列を足す案は、既存の Quality Gate Matrix の解析（`gateRow`）と列位置が衝突しやすいため採用しない。値に low / medium / high 以外が含まれるときは doctor と reporter が入力エラー（2）にする。黙って無視すると、方針を書いたつもりで効いていない状態になるからである。行が無い場合は空集合として扱い、既存動作になる。

### 2. TP の Level は test-plan の Risk 列から引く

reporter は TP 行の `Risk` を quality.md の Risk Register の `Level` に解決する。解決できない場合（quality.md が無い、Risk が登録されていない）は plan-check がすでに失敗にしている。reporter 側では安全側に倒し、その TP の flaky を不合格扱いにして理由を表示する。1 つのテストが複数の TP にタグ付けされている場合は、最も高い Level で判定する。

### 3. 不合格の flaky は終了コード 3

不合格の flaky は「テストが信頼できる結果を出さなかった」ことを意味するので、欠落（1）ではなく失敗（3）とする。表の結果列は `pass` のまま、フレーク列に `⚠ 不合格（high）` と出す。既存 spec の「pass と flaky を両方表示する」と矛盾させないためである。

### 4. 隔離リストは E2E ルート直下の Markdown 表

`installedE2eRoot` 直下に `quarantine.md` を置く。列は `TP-ID | Change | 理由 | 担当 | 期限 | 代替` とする。テストコードの `test.fixme` や `test.skip` で隔離する案は、e2e-conventions がすでに禁止している「skip の追加」と区別できないため採用しない。レビューで差分が見える 1 ファイルに集約する。

- `期限` は YYYY-MM-DD。期限日当日までは有効とし、比較は UTC の日付で行う。
- `代替` は、その change の quality.md にある E2E 以外の層の Oracle ID（`O*`）か、evidence の Residual ID のどちらかを必須とする。
- `Change` が未指定の行は受け付けない。同じ TP-ID は change ごとに別物であり（既存の Scoped test identifiers 要件）、change をまたいで隔離が効いてはならない。

### 5. reporter と final ゲートで責務を分ける

- reporter: 有効な隔離（期限内、必須列あり、change 一致）の TP は coverage に数えない。欠落からも除外し、`隔離中` として別の行で表示する。期限切れ、必須列の欠落、代替なしは欠落（1）と同じ扱いで失敗させ、理由を表示する。隔離中の TP のテストが実行されて pass しても coverage には数えない（解除は人間がリストから行を消すことで行う）。
- final ゲート（evidence-check）: 隔離中の TP がある change について、代替が Oracle ID なら `risk_results` にその Oracle を含む `pass` の結果があること、Residual ID なら `residuals` に承認者と日付がある項目があることを検査する。reporter は evidence を読まないので、この確認は final でしか行えない。

### 6. 旧 schema は対象外

`spec-driven-e2e` の change は Risk 列を持たないため、フレーク方針も隔離リストも適用しない。隔離リストに旧 schema の change が書かれていたら警告だけを出す。

## Risks / Trade-offs

- [隔離が恒久化して、守られていない TP が増える] → 期限を必須にし、期限切れは失敗にする。隔離中の件数を reporter が毎回表示する。
- [policy で high を不合格にすると、初期は CI が頻繁に落ちる] → 既定は方針なし（従来動作）にし、導入の手順を docs に書く。隔離リストを逃げ道として用意する。
- [1 回の実行の分類だけでは、たまにしか出ないフレークを捕まえられない] → Non-Goals として後続の履歴蓄積 change に回す。Residual Risk に記載する。

## Migration Plan

- 既存の利用者は何もしなくてよい（方針の行と隔離リストが無ければ従来どおり）。
- 有効にする場合は policy に `flaky_fail_levels:` を追記し、必要なら `quarantine.md` の雛形を使う。kit の install は雛形を新規作成するだけで、既存の `quarantine.md` は上書きしない。
- 戻すときは policy の行を消す。
