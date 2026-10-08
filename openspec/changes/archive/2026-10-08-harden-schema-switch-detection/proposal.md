# Proposal

> この change は `openspec_custom_testkit` リポジトリで apply する前提で起票している。`openspec/changes/harden-schema-switch-detection/` を testkit リポジトリへ移動してから apply する。

## Why

`add-derived-schema-compatibility`（PR #14）の導入後のレビューで、統合ゲートを外せる経路が2つ見つかった。どちらも、testkit を導入した一時 repo で exit 0 になることを確認している。

1. **宣言を2回の PR で削除する**
   - PR1 で派生 schema の `testkit-compat.json` だけを削除する。select は `openspec/changes` の差分しか見ないので、選ばれる change は0件になり、ゲートは成功する。
   - PR2 で、承認の無いまま実装タスクを完了にする。比較元にはもう宣言が無いので、その change は「無関係な schema」として対象外になる。
2. **change の schema 名を付け替える**
   - 進行中の統合 change（`quality-driven-e2e` でも派生 schema でもよい）の `.openspec.yaml` の `schema:` を、宣言の無い名前や旧 schema に書き換える。
   - HEAD の schema だけで判定されるので、change は対象外か旧 schema 扱いになる。この経路は PR #14 より前からある。

どちらでも統合 change ではなくなるため、e2e-lint は `QE_E2E_LINT_MODE` / `QE_E2E_LINT_SCOPE` を無視しなくなる。その結果、環境変数で lint を `warn` に落とせる。testkit の目的は Agent による Reward Hacking の防止なので、メタデータを書き換えるだけで人間ゲートを外せる経路は塞ぐ必要がある。

## What Changes

- 比較元 ref がある選択では、`openspec/schemas/` の差分も見る。比較元で有効だった派生 schema の宣言が、HEAD で削除されたり無効になったりしたら、その schema を宣言している HEAD の active change をすべて選択に加える。加えた change は統合 change として検査を続け、失敗させる。その schema を使う active change が無ければ、削除を許す。
- 比較元で統合系統（`quality-driven-e2e` または有効な派生 schema）だった change が、HEAD で統合系統以外の schema（宣言の無い独自 schema、`spec-driven`、`quality-driven`、`spec-driven-e2e`、無効な宣言の schema）に変わったら、統合 change として検査を続け、失敗させる。統合系統どうしの付け替え（統合 schema と派生 schema の間、派生 schema どうし）は許す。
- 上の2つで統合扱いを続ける change では、e2e-lint も統合 schema の扱いを維持する。環境変数で lint を弱められないことを回帰テストで固定する。
- `docs/workflow.md` の派生 schema の節に、次の2点を書く。
  - 宣言の削除と schema の付け替えは失敗すること
  - 比較元 ref を付けた CI の検査が前提で、main への直接 push はブランチ保護で防ぐこと

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities
- `derived-schema-compatibility`: 「Fail closed on broken or removed declarations」で、宣言の削除や無効化を、その schema を使う change が差分に無くても検出する。
- `change-gate-selection`: 「Fail closed on ambiguous metadata」で、比較元で統合系統だった change の schema を統合系統の外へ付け替えることを、失敗として扱う。

## Impact

- 対象リポジトリ: `sudabon/openspec_custom_testkit`
- コード: `payload/scripts/lib/select.mjs`（主な変更）、`payload/scripts/lib/schema-family.mjs`（比較元で有効だった宣言の一覧を返す関数を追加）
- テスト: `test/derived-schema.test.mjs`、`test/cli-regressions.test.mjs`、`test/e2e-lint.test.mjs`
- 文書: `docs/workflow.md`、`docs/verification-log.md`
- 互換性:
  - 統合 change の schema を統合系統の外へ変える運用は、これからは失敗になる。そうしたい場合は、新しい change-id で作り直す。
  - 比較元 ref を付けない検査（`check` を引数なしで実行し、active を全件見る場合）の挙動は変えない。
