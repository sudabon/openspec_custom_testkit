# Design

## Context

動機は proposal.md の Why を参照。PR #14 の時点の `payload/scripts/lib/select.mjs` は、次のように動く。

- `selectChanges` は、比較元 ref があるとき `git diff --name-status <base> HEAD -- openspec/changes` だけから対象を作る（`recordsFromDiff`）。`openspec/schemas/` の差分は対象の決定に使わない。
- `decorate` → `applyFamilies` → `resolveSchema` の順に、change の schema を決める。
  - `applyFamilies` は、HEAD の schema 名について、比較元で宣言が有効だったか（`atBase`）を見る。これで「宣言が消えた」を検出するが、それは change が選択に入っている場合に限られる。
  - `resolveSchema` は、HEAD の metadata が壊れたか欠けたときだけ比較元の schema に頼る。HEAD に正しい形の別の schema 名があれば、その名前をそのまま使う。
- e2e-lint の `modeFor`（`e2e-lint/repo.mjs`）は `isIntegratedChange(change)` で強制するかを決める。select が統合扱いにすれば（`scope: 'integrated'` / `schema: quality-driven-e2e`）、環境変数は無視される。

## Goals / Non-Goals

**Goals:**
- 比較元 ref を付けた検査で、宣言の削除と schema の付け替えの2経路を、どちらも1回目の PR で失敗させる。
- 修正は select の対象判定に閉じ、下流（evaluate / lint / seal）は今の「統合扱いなら強制」をそのまま使う。

**Non-Goals:**
- 比較元 ref を付けない検査（active 全件の検査）で、過去の宣言や schema を推測すること。履歴が無いので判定できない。CI の PR 検査（`ci-job.mjs` は merge-base を渡している）とブランチ保護を前提にする。
- 統合 schema（`openspec/schemas/quality-driven-e2e/`）自体の改変の検出。ゲートの判定は schema.yaml ではなくコードの規則で行うので、統合 change の検査は弱まらない。
- archive 済みの change の schema の付け替えの検出。archive への移動は `recordsFromDiff` が既に扱っており、移動後の `.openspec.yaml` も同じ付け替えの判定を通る。

## Decisions

### D1. 宣言が無効になったら、その schema を使う active change を選択に加える

- `selectChanges` は比較元 ref があり、かつ `git diff --name-only <base> HEAD -- openspec/schemas` が空でないときに限り、次の処理をする。
  - `schema-family.mjs` に追加する `listCompatDeclarations(repo, { rev })` で、比較元で有効だった宣言の schema 名の集合を作る。`git ls-tree` で `openspec/schemas/*/testkit-compat.json` を列挙し、`readCompatDeclaration` を `rev` 付きで呼ぶ。
  - その集合のうち、HEAD で `resolveSchemaFamily(...).derived` が偽になったものを「失効した宣言」とする。
- HEAD の active change のうち、`.openspec.yaml` の schema が失効した宣言のものを、`recordsFromDiff` の結果に（重複を除いて）`lifecycle: 'active'` で加える。加えた change は `decorate` → `applyFamilies` の既存の `atBase.derived` 経路で、統合扱いのまま失敗する。比較元に change が無い場合でも、`atBase` は schema 名で比較元の宣言を見るので、同じく失敗する。
- 失効した宣言を使う change が無ければ、何も加えない。これでアドオンのアンインストールを妨げない。
- 不採用: 宣言の削除そのものを常に失敗にする方式。使っていない派生 schema を消すことも、永久にできなくなる。
- 不採用: `openspec/schemas/` に差分があるとき active を全件選ぶ方式。無関係な change の失敗まで PR に持ち込むことになる。
- `git ls-tree` / `git show` の失敗は、既存の比較元の読み込みと同じく、終了コード 2（入力エラー）にする。「失効なし」には変換しない。

### D2. 比較元で統合系統だった change は、HEAD で系統の外へ出られない

- `applyFamilies` で、比較元の系統（`baseFamily.family`）が `quality-driven-e2e` で、HEAD の系統がそれ以外の場合は、既存の `failClosed` を使う。ここでいう HEAD の系統には、宣言の無い独自 schema、旧 schema、`spec-driven`、無効な宣言を含む。メッセージは `比較元で統合系統だった change の schema が <base> から <head> に変更されています。統合 change として検査を続けます` とする。
- 判定の順序は次のとおり。
  1. 比較元の読み込み失敗（unreadable）
  2. HEAD が統合系統（そのまま通す）
  3. 比較元の系統が統合系統で、HEAD がそれ以外（今回追加する D2）
  4. 既存の `atBase.derived` による宣言の消失
  5. HEAD の宣言の無効

  2 を先に置くので、統合系統どうしの付け替えは失敗しない。
- `rawBase` は `record.baseDir ?? record.dir` から読むので、archive への移動でも比較元の change と照合できる。
- 不採用: `resolveSchema` で `head.schema !== base.schema` を一律に失敗にする方式。旧 schema どうしや、無関係な schema どうしの付け替えまで失敗になり、既存の互換（`Unrelated schema`）を壊す。

### D3. lint は select の結果に従うだけにする

`modeFor` は変更しない。D1・D2 で統合扱いを続ける change は `scope: 'integrated'` になる。そのため `isIntegratedChange` が真になり、`QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` は無視される。これを回帰テストで固定する。lint の側で別に履歴を見る判定を持つと、select と食い違う原因になるので持たない。

## Risks / Trade-offs

- [統合 change を統合系統の外へ移したい正当な理由がある] → 新しい change-id で作り直す運用にし、docs/workflow.md に書く。元の change は archive すれば最終検査を受けるので、削除による抜け道にもならない（既存の「archive せず削除」は失敗する）。
- [`openspec/schemas/` に差分がある PR では、選択の計算が増える] → 宣言の数 × git 呼び出し回数で済む。差分が無ければ追加の計算はしない。
- [比較元 ref を付けない検査では、2回の PR に分けた削除を検出できない] → Non-Goals に書いたとおり。PR の CI は必ず merge-base 付きで検査することと、main への直接 push をブランチ保護で防ぐことを、docs に明記する。

## Migration Plan

- 既存の repo への影響は、統合系統の change の schema を付け替えている PR と、使用中の派生 schema の宣言を消している PR だけが失敗するようになること。どちらも今まで検査が外れていたケースである。
- ロールバックは testkit の前の版への update で戻る。
