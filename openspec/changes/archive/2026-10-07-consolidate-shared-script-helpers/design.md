# Design

## Context

主な重複箇所は次のとおり（行番号は起票時点のもの）。

- **`.openspec.yaml` の検証**
  - `coverage-map.mjs:142` `schemaOf`
  - `plan-check.mjs:225` `createdOf`
  - `effort.mjs:60,71` `defaultSchema` / `schemaOf`
  - `select.mjs:23` `interpretSchema`
- **archive フォルダ名の正規表現**
  - `coverage-map.mjs:24`、`select.mjs:9`、`effort.mjs:112,115`、`e2e-lint.mjs:1063`
- **change の列挙**
  - `coverage-map.mjs:304-327`、`e2e-lint.mjs:1057-1069`、`effort.mjs:101-103`
- **policy のパスと読み込み**
  - `qe-gate.mjs:122`、`evaluate.mjs:49`、`doctor.mjs:36`、`flaky.mjs:120`、`e2e-lint.mjs:1122`
- **policy のキー行パーサ**
  - `policy.mjs` の `flakyFailLevels`、`mockContractMaxAgeDays`、`qaReviewRequiredLevels`
  - 3つとも「候補行の検出 → 書式違反の判定 → 複数行の判定 → 値の解析」という同じ流れになっている。
- **integrated の判定**
  - `isIntegratedChange`（critical.mjs）と同じ条件を、`e2e-lint.mjs:1030` `isIntegrated`、`qe-gate.mjs:58`、`flaky.mjs:108` がそれぞれ書いている。
- **E2E required の判定**
  - `ci-job.mjs:131`、`testkit-gate.mjs:120`、`check-test-plan.mjs:45`、`evaluate.mjs:195`
- **repo の解決**
  - `qe-gate.mjs:16-22`、`testkit-gate.mjs:19-25`、`e2e-report.mjs:24-29`、`check-test-plan.mjs:8-14`
  - `check-test-plan.mjs` だけは、失敗したときに exit 2 する。

## Goals / Non-Goals

**Goals:**
- 上の重複を、それぞれ1つの定義元にまとめる。
- 呼び出し側から、正規表現・パス・判定式の直書きをなくす。

**Non-Goals:**
- 挙動をそろえること。まとめた helper は、今の差を引数で表せる形にする。
- 引数パーサを `node:util` の `parseArgs` に統一すること。`--x=v` を受け付けるかどうかで CLI の挙動が変わるので、この change では行わない。
- 関数の分割。

## Decisions

- **挙動を保つための方針: 呼び出し元ごとに今の挙動を引数で固定する**
  - 例: `readChangeMetadata(repo, dir, { strict })`
    - `strict: true` は今の `effort` の挙動にあたり、mapping でない値や文字列でない schema を拒否する。
    - `strict: false` は今の `select` の挙動にあたる。
  - 例: `policyKeyLine(text, key, { stripComment })`
    - `flakyFailLevels` だけは今の挙動のまま `stripComment: false` を渡す。
  - これにより、不一致がコード上に名前の付いた引数として見えるようになる。後で挙動をそろえるときは、その引数を消すだけでよくなる。
  - 代替案「まとめると同時に、厳しい方へ統一する」は採らない。spec の差分と利用者への影響の評価が必要になり、リファクタリングと混ぜるとレビューしにくくなるため。
- **TP-ID は2つの定数に分ける**
  - `TP_ID`（`/^TP-\d{3}$/`、セル全体と一致させる）と `TP_ID_IN_TEXT`（`/TP-\d{3}(?!\d)/g`）を `ids.mjs` に置く。
  - `markdown.tpReferences` は今の `TP-\d+` を保つ。そのため、定数としては別名の `TP_REFERENCE_LOOSE` を使い、コメントに不一致があることを書いておく。
- **`isIntegratedChange` と `isE2eRequired` に置き換えるのは、同じ式になる箇所だけにする**
  - 同じ式の箇所: `e2e-lint.isIntegrated`、`qe-gate:58`、`flaky:108` は `schema === INTEGRATED || scope === 'integrated'` で同じなので置き換える。
  - 違う式の箇所: `plan-check.mjs:255` は `[INTEGRATED, E2E].includes(schema) || scope === 'integrated'` で条件が違うので、`isIntegratedChange(change) || change.schema === SCHEMA_E2E` と書き換える。
- **`entry.mjs` は lib の外の関心事（process、env、stdout）を扱うので、関数は `io` / `env` を引数で受け取る**
  - `resolveRepo(cwd, { onFailure: 'cwd' | 'exit2' })` で、`check-test-plan` だけ違う今の挙動を保つ。
- **新しいモジュールを `REQUIRED_MODULES` に追加する**
  - 共通モジュールは既存の CRITICAL なスクリプトから import される。
  - そのため、古い kit のままの導入先は、ファイルが欠けると実行時に失敗する。doctor で検出できるよう `REQUIRED_MODULES` に追加する。

## Risks / Trade-offs

- [helper にまとめたことで、メッセージの文言がわずかに変わる] → エラーメッセージは呼び出し元が組み立てる形のまま残す。既存テストの文言 assert が通ることで確かめる。
- [import が増えて循環参照が起きる] → `critical.mjs`、`ids.mjs`、`frontmatter.mjs` は他の lib を import しない葉のモジュールに保つ。`change-metadata.mjs` は `frontmatter` と `environment` だけに依存させる。
- [`REQUIRED_MODULES` への追加で、既存の導入先の doctor が incomplete を出す] → kit の更新では新しいファイルが配置されるので、これは正しい診断である。`docs/migration.md` に追記する。

## 保留した不一致（後続 change の候補）

次の不一致は、この change では挙動を保ったまま残す。修正する場合は、spec の差分を伴う別の change として起票する。

- TP-ID の判定
  - `tpReferences` だけ `TP-\d+` で、他は `TP-\d{3}`。
- `.openspec.yaml` の解釈
  - mapping でない値や文字列でない schema を、`effort` は拒否し、`select` は受け入れる。
- policy の行末 `#` コメント
  - `flaky_fail_levels` だけが、行末の `#` コメントを除去しない。
- RegExp に入力をエスケープせずに渡している箇所
  - `plan-check.mjs:347` の `oracle.ID`
  - `frontmatter.setFrontmatterScalar` の `key`（加えて、`value` の `"` もエスケープしていない）
- Scenario 見出しの抽出の不一致
  - `plan-check.scenariosOf` はコードフェンスを除去しないが、`coverage-map.parseSpec` は除去する。
- 終了コードの不一致
  - `qe-gate check` は `!selected.ok` のときに 1 を返すが、`testkit-gate check` は failures の有無だけで判定する。
