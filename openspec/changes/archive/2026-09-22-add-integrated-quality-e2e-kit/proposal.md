# Proposal

## Why

既存の QE kit と E2E kit を同時導入しても、quality と test-plan の依存関係、Risk / Oracle / TP-ID の追跡、CI の対象判定は統合されない。`OPENSPEC_CUSTOM_TESTKIT_IMPLEMENTATION_BRIEF.md` に基づき、既存プロジェクトを保持しながら、計画から独立検証・証跡まで一貫して利用できる bootstrap kit を提供する。

## What Changes

- `quality-driven-e2e` を新設し、proposal → specs → quality → design / test-plan → tasks を提供する。evidence は実行後の成果物とする。
- 統合版は **全Riskで人間による quality 承認、Oracle seal、独立した反証を必須**とする。これは2026-09-22のユーザー判断であり、ブリーフ§6の low に関する任意規定に優先する。旧スキーマの品質基準は遡及変更しない。
- 単一の `openspec-custom-testkit` CLI で install / update / dry-run、設定保持、旧 kit からの安全な移行を提供する。
- 共通の change 判定を使い、QE、E2E、archive の検査漏れ、古い実行結果や他 change の TP-ID による誤った成功判定を防ぐ。
- 日本語の利用・移行・互換性・出典文書、CI の明確な実行契約、回帰テストと実際の Playwright smoke を提供する。

## Capabilities

### New Capabilities

- `integrated-quality-workflow`: 統合スキーマ、計画成果物の責務、適用状態と独立検証・人間承認の境界。
- `safe-kit-installation`: 冪等な CLI、設定・利用者編集の保持、安全な配置と旧 kit の移行。
- `change-gate-selection`: スキーマ、差分、active / archived による共通対象判定と互換性。
- `quality-evidence-gates`: Risk、承認、seal、反証、Mutation、archive 時の証跡検査。
- `e2e-plan-reporting`: 全シナリオの層選択、TP-ID、実行結果の識別・鮮度・終了コード。
- `ci-distribution-contract`: CI の準備と失敗伝達、配布、対応環境、ドキュメントと検証。

### Modified Capabilities

なし。現リポジトリに既存の capability spec はない。

## Impact

- 新設対象: `install.mjs`、`package.json`、`payload/`、`test/`、`docs/`、`.github/workflows/`。README とライセンス・出典表示を整備する。
- 採用基準: QE `e537d10da53112fce684f31d1602c1e061ab87a2`、E2E `53e354fa366f02cf412e9ce93419463a37e8255c`。両者の MIT 表示を保持する。
- 旧 CLI 引数、レポータの終了コード、旧スキーマと進行中 change を保持する。統合版固有の厳密な検査は明確なインターフェースで提供する。
- Node.js 20以上を移植元の最低要件とし、OpenSpec 1.13.1を初期検証基準とする。対応範囲の確定には実装後の検証を必要とする。
- 今回の開発用 change は既存の `spec-driven` を使用し、配布スキーマとの自己依存を作らない。検証計画は design にまとめる。
- 対象外: 外部 store への配置、npm公開、push・公開リリース、旧リポジトリ改修・廃止、全言語の環境構築、生成済み opsx コマンドの編集、実承認の代筆・自動seal。
