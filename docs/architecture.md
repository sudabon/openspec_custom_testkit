# 構成

`openspec-custom-testkit` は一つの CLI で、三つの schema を配布する。

- `quality-driven-e2e`: proposal → specs → quality → design と test-plan（互いに依存しない）→ tasks。evidence は template だけで、apply の依存ではない。
- `quality-driven`: 旧 QE。test-plan を要求しない。low の seal と反証はプロジェクトの旧 policy に従う。
- `spec-driven-e2e`: 旧 E2E。quality を要求しない。`e2e` キーが無くても required と読む。

ゲートの実装は `payload/scripts/lib/` にあり、導入先の `scripts/` へコピーされる。インストーラ本体はパッケージの `lib/` に残り、導入先には入らない。

統合 digest は `manifest-sha256:` で、空集合を拒否する。旧 schema は `sha256:` と `hex  path`（空白二つ）の行を維持し、既存の空でない seal を無効にしない。

`QE_SCHEMA` は旧 schema の追加選択だけに使い、統合 change は常に対象に含める。`QE_SEAL_REQUIRED_LEVELS` は旧 schema の seal 対象だけを変え、統合 schema の全 Risk seal は外せない。
