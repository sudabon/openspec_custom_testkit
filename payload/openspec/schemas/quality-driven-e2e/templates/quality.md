---
risk_level: medium        # high | medium | low（Risk Register の最大値。Agent は承認欄を埋めない）
approved_by: ""           # 全 Risk で必須。空 = 未承認。Agent は編集禁止
approved_at: ""           # YYYY-MM-DD。全 Risk で必須。Agent は編集禁止
oracle_paths: []          # 例: ["tests/oracle/<change-name>/"]
oracle_digest: ""         # scripts/qe-gate.sh seal が書き込む。Agent は編集禁止
---

# Quality

統合 schema では low を含む全 Risk で、人間の承認、Oracle seal、独立反証が必須です。このファイルに `e2e` フラグは置きません。

## Risk Register

| ID | 壊れ方 | 影響 | 発生可能性 | Level | 関連Requirement |
|----|--------|------|------------|-------|-----------------|
| R1 |        |      |            |       |                 |

## Failure Modes

| ID | Failure Mode | Risk | 観点 |
|----|--------------|------|------|
| F1 |              | R1   | 境界値 / 異常入力 / エラーハンドリング / 再試行・冪等性 / 並行 / 状態遷移 / 認可 / 後方互換 |

## Test Oracles

| ID | 対象 (F* / Scenario) | 観測点 | 期待状態 (値 or 不変条件) |
|----|----------------------|--------|---------------------------|
| O1 | F1                   | DB / Queue / 外部API呼び出し / レスポンス | |

## Test Layer Mapping

| Failure Mode | Layer (Static / Unit / Integration / E2E / Monitoring) | 選定理由 |
|--------------|---------------------------------------------------------|----------|
| F1           |                                                         |          |

## Quality Gates

- CI Blocking: 全 Risk で承認、Oracle、独立反証
- Mutation Testing: high は 70% 以上。policy がそれより高ければその値
- Human Review: medium は必須。high はドメイン担当を含む
- 追加ゲート:

## Independent Verification

- Oracle作成: 別コンテキスト。入力は specs と本ファイルと role 定義だけ
- 反証: 実装後の別コンテキスト。全 Risk で必須
- その他:

## Residual Risk

-
