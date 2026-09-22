# AI Quality Policy

このプロジェクトで Coding Agent に実装を委譲する際の品質ポリシー。
各changeの `quality.md` はこのポリシーを前提に作成する。

## 1. 役割分担

| 役割 | 担当 | 責務 |
|------|------|------|
| 正しさの定義 | 人間 | quality.md の承認、Oracle の seal、Residual Risk の受容 |
| 実装 | 実装Agent | 実装、補助テストの生成、失敗解析 |
| Oracle作成 | qe-oracle-writer(別コンテキスト) | specs と quality.md だけを入力に Oracle テストを作成 |
| 反証 | qe-falsifier(別コンテキスト) | 実装が間違っていることを証明するテストを作成 |
| 強制 | CI | 決定的なゲート。OpenSpec は artifact の存在しか確認しないため、強制は CI で行う |

## 2. Risk Level

| Level | 目安 |
|-------|------|
| high | 金額計算・課金、認証・認可、個人情報、データ消失・破損、外部への二重送信、不可逆な状態変更、DBマイグレーション |
| medium | 主要ユースケースの機能不全、リカバリ可能なデータ不整合、外部連携の仕様変更 |
| low | 表示・文言、内部ツール、容易にロールバックできる変更 |

<!-- プロジェクトの実情に合わせて書き換えてください -->

## 3. Quality Gate Matrix

| Gate | low | medium | high |
|------|-----|--------|------|
| quality.md の人間承認 | 必須 | 必須 | 必須 |
| Oracle の seal | 必須 | 必須 | 必須 |
| Static Analysis / 型 / Lint | 必須 | 必須 | 必須 |
| Oracle テスト全 Pass | 必須 | 必須 | 必須 |
| Falsification レビュー | 必須 | 必須 | 必須 |
| Mutation Testing | - | 任意 | 必須(閾値 70%) |
| Human Code Review | 任意 | 必須 | 必須(ドメイン担当を含む) |
| Coverage | 参考 | 参考 | 参考(差分Coverageが下がる場合は理由を evidence.md に記載) |

integrated_minimum:
mutation_threshold_high: 70

統合 schema `quality-driven-e2e` では low を含む全 Risk で、人間の承認、Oracle seal、独立反証が必須です。`QE_SEAL_REQUIRED_LEVELS` と `QE_SCHEMA` ではこの条件を外せません。上の表で low が「任意」のままの旧 policy は、統合 schema の doctor を通しません。

## 4. Agent が変更してはいけないもの

- quality.md frontmatter の `approved_by` / `approved_at` / `oracle_digest`
- seal 済みの `oracle_paths` 配下
- このファイル、`openspec/schemas/`、`scripts/qe-gate.sh`、`.github/workflows/`

## 5. Human Review が必須の変更

- risk_level が medium 以上の change
- seal 後の Oracle 変更、Residual Risk の追加
- 認証・認可・課金・個人情報に触れる変更(risk_level に関わらず)

## 6. 禁止パターン(Reward Hacking)

- テスト入力での分岐、期待値のハードコード
- アサーションの緩和、skip / only / xfail の追加
- テスト対象そのもののモック化
- 期待値を実装の出力から逆算すること
- 「全テスト Pass」だけを根拠に完了報告すること
