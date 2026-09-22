---
risk_level: medium        # high | medium | low(Risk Register の最大値)
approved_by: ""           # 品質基準を承認した人間。空 = 未承認(CIがブロック)。Agentは編集禁止
approved_at: ""           # YYYY-MM-DD。Agentは編集禁止
oracle_paths: []          # Oracleテストの配置先。例: ["tests/oracle/<change-name>/"]
oracle_digest: ""         # scripts/qe-gate.sh seal が書き込む。Agentは編集禁止
---

# Quality

<!-- このファイルは「このchangeにおける正しさの定義」です。Greenが何を保証するかは、ここで決まります。 -->

## Risk Register

<!-- 何が壊れたら困るか。レベル定義は openspec/quality-policy.md に従う -->

| ID | 壊れ方 | 影響 | 発生可能性 | Level | 関連Requirement |
|----|--------|------|------------|-------|-----------------|
| R1 |        |      |            |       |                 |

## Failure Modes

<!-- どう壊れるか。正常系以外を必ず検討し、該当しない観点は「該当なし(理由)」と書く -->

| ID | Failure Mode | Risk | 観点 |
|----|--------------|------|------|
| F1 |              | R1   | 境界値 / 異常入力 / エラーハンドリング / 再試行・冪等性 / 並行 / 状態遷移 / 認可 / 後方互換 |

## Test Oracles

<!-- 何を観測すれば正しいと判断できるか。存在確認のみ・ステータスのみ・ログ一致のみは不可 -->

| ID | 対象 (F* / Scenario) | 観測点 | 期待状態 (値 or 不変条件) |
|----|----------------------|--------|---------------------------|
| O1 | F1                   | DB / Queue / 外部API呼び出し / レスポンス | |

## Test Layer Mapping

<!-- Failure Mode ごとに最も適切なLayerを選ぶ。テスト本数ではなく適材適所 -->

| Failure Mode | Layer (Static / Unit / Integration / E2E / Monitoring) | 選定理由 |
|--------------|---------------------------------------------------------|----------|
| F1           |                                                         |          |

## Quality Gates

<!-- quality-policy.md のゲート表を risk_level に適用した結果 + このchange固有の追加ゲート -->

- CI Blocking:
- Mutation Testing:
- Human Review:
- 追加ゲート:

## Independent Verification

<!-- 実装と評価軸をどう分離するか -->

- Oracle作成: 実装とは別コンテキスト(qe-oracle-writer)が specs と本ファイルのみを入力に作成
- 反証: 実装後、別コンテキスト(qe-falsifier)が「この実装が間違っていることを証明するテスト」を作成
- その他:

## Residual Risk

<!-- このchangeのGreenが保証しないこと -->

-
