# Design

## Context

動機は proposal.md「Why」を参照する。現状の `plan-check.mjs` は TP の `Fixture` 列が空でないことだけを見ており、`tests/e2e/fixtures/README.md` は利用者が手で保つ文書にとどまる。README の記述は旧 `spec-driven-e2e` テンプレートの列名「前提(fixture)」のままで、統合テンプレートの列名 `Fixture` と食い違う。モックの置き場所（`tests/e2e/mocks/`）は E2E 規約にあるが、登録表は無い。

E2E ルートは `installedE2eRoot` が stamp から解決する。TP-ID は change ごとに採番されるため、`TP-001` だけでは別 change と区別できない（`e2e-plan-reporting` の Scoped test identifiers と同じ問題）。

## Goals / Non-Goals

**Goals:**

- TP の前提状態とモックが登録表で説明されていることを plan gate で決定的に検査する。
- モック契約の鮮度を final gate で検査し、超過を人間承認済みの Residual にするか、確認し直すかを強制する。
- 既定の動作で外部サービスへ送信しない。

**Non-Goals:**

- fixture の冪等性・状態非共有の機械検査。
- 契約テストの実装やツール（Pact、OpenAPI diff など）の同梱。
- 登録表の行を TP から自動生成すること。登録は状態の説明を人が読める形で残すことが目的であり、自動生成はその説明を空にする。

## Decisions

### 1. 登録表は既存 README の Markdown 表を正本にする

別の YAML / JSON 登録ファイルを作る案は採用しない。既存導入先は README に表を持っており、二重管理になるためである。`fixtures/README.md` は既存の見出し `## fixture 名 → 作られる状態` の表、`mocks/README.md` は `## モック一覧` の表を `parseTable` で読む。名前のバッククォートは除いて比較する。

### 2. 参照の書式

- `Fixture` 列は `,` または `、` 区切りの複数要素を許す。`mock:<name>` はモック、それ以外は fixture 名、`なし` だけなら前提状態なし。
- 登録表の「使用する TP-ID」は `<change-id>:TP-NNN` で書く。bare の `TP-NNN` は統合 change の参照に数えない。既存 README の例 `TP-001, TP-004` は書式例として更新する。
- モックの登録表には TP-ID 列を置かない。モックは多くの TP で共有され、使用箇所の一覧は test-plan 側から逆引きできるため。

### 3. 欠落と旧 schema

- 統合 `required` の change で fixture 名を参照しているのに README が無い場合は失敗にする。黙って対象外にすると、登録を省くだけで検査を迂回できるため。
- 旧 `spec-driven-e2e` は警告だけにする。既存 change の終了コードを変えないという互換の約束（`safe-kit-installation`、`e2e-plan-reporting` の Legacy 系 scenario）を守るため。
- `not-applicable` と旧 `quality-driven` は TP を持たないので対象外。

### 4. 契約の鮮度：日付の鮮度を必須、契約テストは任意

| 案 | 長所 | 短所 |
|---|---|---|
| A. CI 任意入力 `contract-command` だけ | 実物との照合が実行で裏付けられる | 多くの導入先は sandbox 契約や認証情報を持たず、未設定なら何も保証しない。外部送信を伴う |
| B. 最終確認日と policy の日数だけ | 外部送信なしで全導入先に適用できる | 日付は自己申告で、照合の中身は保証しない |
| C. B を必須にし、A を任意で追加 | 最低限の鮮度を全員に課し、可能な導入先は実行証跡も残せる | 入力が一つ増える |

C を採用する。`mock_contract_max_age_days`（既定 90）を policy の機械可読行に置き、final gate で検査する。超過は、該当モック名を含む人間承認済み Residual があれば許容する（既存の Residual 承認検査を再利用）。`contract-command` は指定時だけ実行し、`ci-job.mjs` の他の command と同じ run 記録に残す。成功しても最終確認日は書き換えない。日付は人間が照合内容を確認して更新する欄であり、自動更新は自己申告をさらに弱めるため。

鮮度は検査実行日に依存するので、同じコミットでも日をまたぐと結果が変わる。これは意図した挙動とし、workflow 文書に明記する。

### 5. 冪等性はレビュー観点に留める

fixture コードの冪等性は、実装方式（シード API・DB 直接）ごとに検査方法が異なり、静的検査では誤検知が多い。E2E 規約と Human Code Review の確認項目に置き、gate 出力に「冪等性は検査していない」と表示する。

## Risks / Trade-offs

- [最終確認日が形骸化する] → 鮮度超過を Residual 承認なしでは通さず、更新の判断を人間に残す。`contract-command` で実行証跡を足せる。
- [既存導入先で plan gate が急に失敗する] → `docs/migration.md` に登録の追記手順を書く。kit の update は編集済み README を上書きしない。
- [TP-ID の表記が regression map と食い違う] → `add-regression-coverage-map` の恒久 ID が決まった場合は、参照の解決を一つの関数に集め、表記の追加で対応できるようにする。

## Migration Plan

1. 既知の未編集 fixture README は新版に置き換え、編集済みは保持して差分の案内を出す。
2. `mocks/README.md` は存在しなければ作成する。
3. 既存の進行中 change は、update 後の最初の plan gate で未登録を一覧表示する。旧 schema の change は警告だけ。
4. ロールバックは kit の旧版への update で行う。登録表の追記は残っても無害。
