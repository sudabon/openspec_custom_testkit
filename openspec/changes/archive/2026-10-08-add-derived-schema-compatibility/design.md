# Design

## Context

動機は proposal.md の Why を参照。testkit の現状は次のとおり。

- 統合判定は schema 名の完全一致で行う。`critical.mjs` の `isIntegratedChange`（`schema === 'quality-driven-e2e' || scope === 'integrated'`）と、`select.mjs` の `applicability` が判定の起点になる。
- `select.mjs` の `decorate` が change ごとに `schema` / `scope` / `e2e` / `qe` を決める。下流の `evaluate.mjs` は `isIntegratedChange` が真なら `schema` を `SCHEMA_INTEGRATED` に置き換えてから検査する。`plan-check` / `evidence-check` / `digest` / `seal` / `flaky` / `e2e-lint/repo` は、この正規化済みの `schema` か `isIntegratedChange` を見る。
- `coverage-map.mjs` と `effort.mjs` は select を通らない。archive の `.openspec.yaml` を自前で読み、`SCHEMA_INTEGRATED` と比較している。
- `qe-gate.mjs` の seal は、`isIntegratedChange` で digest の形式（`manifest-sha256:` か旧 `sha256:`）を決める。
- install は payload にあるファイルだけを配置する。`openspec/schemas/` 配下の未知のディレクトリには触れない（`lib/cli.mjs`）。
- OpenSpec 1.13 の schema.yaml は zod で検証され、使えるキーは `name` / `version` / `description` / `artifacts` / `apply` だけで、継承は無い。

## Goals / Non-Goals

**Goals:**
- 判定の入口を一箇所（schema 系統の解決）にまとめ、既存の `=== SCHEMA_INTEGRATED` 比較の大半を変えずに派生 schema を通す。
- 宣言の不備や消失を、検査が外れる方向には決して倒さない（fail closed）。

**Non-Goals:**
- 派生 schema が追加した artifact（モックアップ計画など）を testkit が検査すること。アドオンのゲートで扱う。
- testkit の CI ジョブ（`ci-job.mjs`）からアドオンのゲートを呼ぶプラグイン機構。必要になれば別 change にする。
- 統合 schema 以外（`quality-driven` / `spec-driven-e2e`）を継承元にすること。
- schema.yaml の生成や同期。派生 schema の生成はアドオンの責務とする。testkit は宣言と構造を検査するだけ。

## Decisions

### D1. 宣言は schema.yaml ではなく隣の `testkit-compat.json` に置く

- 採用: `openspec/schemas/<name>/testkit-compat.json` に `{"extends": "quality-driven-e2e", "compatVersion": 1}` を置く。
- 不採用 (a): schema.yaml に独自キー（`x-testkit` など）を書く方式。OpenSpec の zod object は未知キーを捨てるので今は通る。しかし将来 strict になったら全派生 schema の読み込みが壊れる。OpenSpec の互換に依存したくない。
- 不採用 (b): testkit の stamp（`.openspec-custom-testkit.json`）へ登録する方式。stamp は testkit の install が書き換える正本なので、アドオンが書くと update で消える。
- 不採用 (c): `quality-driven-e2e-*` のような名前規約で判定する方式。意図しない schema まで統合扱いになり、逆に名前を変えるだけで検査を外せてしまう。
- JSON にしたのは、vendored yaml を使わずに厳密に解析でき、alias や tag の扱いを考えなくて済むからである。

### D2. 構造検査で「統合 schema の上位集合」であることを確かめる

宣言だけを信じると、artifact を削った派生 schema でも統合扱いの検査が走る。test-plan や quality が無いまま、ゲートが想定外の入力で落ちたり、別の理由で通ったりしうる。そこで、統合 schema の6 artifact の `generates` と `requires`、`apply.requires` / `apply.tracks`、evidence と qa-handoff のテンプレートの有無を検査する。比較元は、導入先に配布済みの `openspec/schemas/quality-driven-e2e/schema.yaml` を読む。期待値をコードに直書きすると、testkit 自身が schema を更新したときにずれるからである。統合 schema が見つからないときは、宣言を無効として扱う。統合 schema が無い repo では、doctor が別途失敗する。schema.yaml の解析には既存の `frontmatter.mjs` の YAML ラッパー（alias と tag を拒否する）を使う。

### D3. 判定の入口を `schema-family.mjs` にまとめ、select で正規化する

- `resolveSchemaFamily(repo, schema, { rev })` は、`{ family, declared, derived, error }` を返す。`family` は次のとおり。
  - 統合 schema 自身と有効な派生 schema: `quality-driven-e2e`
  - 宣言の無い schema: そのままの名前
  - 宣言が無効な schema: `null` と `error`
- `select.mjs` の `decorate` は `resolveSchema` のあとで系統を解決する。レコードの `schema` には系統名を入れ、新しく `declaredSchema` に宣言上の名前を入れる。こうすると、下流の `evaluate` / `plan-check` / `evidence-check` / `digest` / `seal` は `schema === SCHEMA_INTEGRATED` のままで派生 schema を扱える。変更箇所が小さく、比較の書き換え漏れによる検査漏れが起きにくい。
- 不採用: 全箇所の `=== SCHEMA_INTEGRATED` を `isIntegratedSchema(repo, schema)` に書き換える方式。触る箇所が20を超え、一つでも漏れると、その検査だけが派生 schema で外れる。
- select を通らない `coverage-map.mjs` と `effort.mjs` は、metadata を読んだ直後に `resolveSchemaFamily` を通す。`coverage-map` の「未対応 schema の警告」は、系統名で比較した結果に対して出す。
- `qe-gate.mjs` の seal は、select 経由の `isIntegratedChange` で判定するので、追加変更は不要である。テストで `manifest-sha256:` になることを確かめる。

### D4. 比較元と HEAD の和集合で統合扱いを決める（fail closed）

`--base` があるときは、比較元 ref の宣言も `git show <ref>:openspec/schemas/<name>/testkit-compat.json` で読む。

- 比較元で有効な宣言が HEAD で消えたか無効になったときは、統合扱いを続ける（`forcedIntegrated`）。その上で、エラーを積んで非ゼロにする。これは既存の「比較元が統合 schema の change から metadata が失われた」扱いと同じ考え方である。
- HEAD の宣言が無効なときは、`scope: 'unknown'` にして失敗させる。対象外にはしない。
- 宣言ファイル自体が無い独自 schema は、従来どおり `out-of-scope` とする。

### D5. QE_SCHEMA は系統解決のあとで評価する

`decorate` の `qe` 判定は、系統名が `quality-driven-e2e` なら常に真になる。`QE_SCHEMA` に派生 schema 名を入れても、旧 QE 扱いには変わらない。

### D6. 出力の互換

- `select --json` の要素に `declaredSchema` を足す。既存キーの意味は変えない。`schema` は系統名、統合と旧 schema では `declaredSchema === schema` となる。
- テキスト出力は、派生 schema のときだけ `schema: quality-driven-e2e (宣言: <name>)` の形で両方を出す。

### D7. doctor と install

- doctor は `openspec/schemas/*/testkit-compat.json` を列挙する。有効なものは注記に、無効なものは失敗に入れる。
- install は従来どおり派生 schema のディレクトリに触れない。これは回帰テストで固定する。`config-merge.mjs` は、既定 schema が有効な派生 schema のときに「自動変更しない」という警告を出さない。
- `REQUIRED_MODULES` に `scripts/lib/schema-family.mjs` を足す。旧版の導入では doctor が incomplete を報告する。

## Risks / Trade-offs

- [宣言を置くだけで、任意の schema が統合ゲートの対象になる] → 宣言は検査を足す方向にしか働かないので、弱める手段にはならない。誤って置いた場合は、ゲートが失敗して気付ける。
- [派生 schema が統合 schema の instruction を書き換え、Agent への指示を弱める] → 構造検査は `generates` / `requires` / `apply` だけを見て、instruction の文面は比べない。弱い instruction でもゲートは統合 schema と同じ基準で判定するので、検査は外れない。instruction の妥当性は、アドオンの doctor（統合 schema との同期チェック）と人間のレビューに委ねる。docs/workflow.md にこの限界を書く。
- [testkit の update で統合 schema の artifact が増えた場合、旧い派生 schema の構造検査が失敗する] → これは意図した挙動で、派生 schema の再生成を促す。doctor の失敗メッセージに「アドオンの再生成」を案内する。
- [`git show` の失敗（浅い clone など）] → 既存の比較元読み込みと同じエラー経路にし、対象ゼロとして成功させない。
- [既存 spec の文言との衝突] → `regression-coverage-map` の「Missing plan depends on the schema」は `quality-driven-e2e` を名指ししている。この change では spec 本文を変えず、`derived-schema-compatibility` の「既存 spec の統合 schema には派生 schema も含む」という定義で解釈する。名指し箇所を「統合 schema（派生を含む）」へ書き換えるかは、archive 時に人間が判断する。

## Migration Plan

1. testkit をこの change の版に update する。stamp に `schema-family.mjs` が記録される。
2. 既存の repo は、派生 schema が無ければ挙動が変わらない。
3. アドオンは、この版以上の testkit を前提にする。アドオンの install と doctor は `scripts/lib/schema-family.mjs` の存在で対応版かを判定する。
4. ロールバック: testkit を前の版に戻すと、派生 schema の change は再び対象外になる。そのため、アドオン導入後の downgrade は doctor（アドオン側）で検出させる。

## Open Questions

- `testkit-compat.json` の `compatVersion: 2` が必要になる条件（統合 schema の破壊的変更時）は、その時点で決める。今回は `1` だけを受け付ける。
