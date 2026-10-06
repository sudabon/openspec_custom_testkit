# Proposal

## Why

現在のゲートは、各 change の delta spec に含まれるシナリオだけを test-plan に割り当てて検査する。archive 後は、main spec のどのシナリオが今どのテストで守られているかを一覧できない。そのため QA は「既存仕様が自動テストで保護されている」と判断できず、手動の回帰テストを続けることになる。main spec の全シナリオとテストの対応表を出し、保護されていない範囲と古くなった対応を見える形にする。

## What Changes

- 新しい gate サブコマンド `testkit-gate.mjs coverage` を追加する。`openspec/specs` の全シナリオを、archive 済み change の test-plan.md（TP 行と `## 対象外シナリオ` 行）と照合し、Markdown 表で出力する。
- シナリオを「保護（E2E）」「保護（他層の宣言）」「未保護」「要再確認」「孤立」に分類する。要再確認は、対応する TP より後の change で Requirement が ADDED・MODIFIED・RENAMED で再定義されたもの。孤立は、REMOVED / RENAMED で main spec から消えたシナリオを指す TP。
- Playwright の全量実行 JSON を任意で渡すと、E2E 対応行に最新の実行結果（pass / fail / flaky / 未実行）を添える。照合は既存と同じ change id と TP-ID のトークン完全一致で行う。
- テストのタグは付け替えない。既存の `@<change-id>` と `@TP-NNN` をそのまま使う。
- 再利用可能 workflow に任意入力 `regression-command` と `coverage-strict` を追加する。未指定時は従来の挙動を変えない。
- 旧 `spec-driven-e2e` の archive 済み change も、TP 表が解析できる範囲で取り込む。解析できない行は「旧形式・対応不明」として表示し、保護には数えない。

## Capabilities

### New Capabilities

- `regression-coverage-map`: main spec の全シナリオとテスト（E2E の TP と他層の代替検証）の対応表、古い対応と孤立したテストの検出、全量実行結果との突き合わせ。

### Modified Capabilities

なし。既存 capability の要件は変更しない。CI 入力の追加は新 capability 側の要件として定義する。

## Impact

- 追加: `payload/scripts/lib/coverage-map.mjs`、`payload/scripts/testkit-gate.mjs` の `coverage` サブコマンド、`test/` の fixture とテスト、`docs/workflow.md` と README の説明。
- 変更: `.github/workflows/openspec-custom-testkit-gate.yml` と `payload/scripts/ci-job.mjs` に任意入力を追加する。既存の入力・plan/final 検査は変えない。不正な Playwright JSON（suites 欠落・トップレベル errors を含む）は、共有検証により既存レポーターでも終了コード 2 になる。従来その入力で返していた 1 または 3 からの変更である。正常な入力の終了コードは維持する。
- `report.mjs` の結果の平坦化と状態分類を `results.mjs` に共通化して再利用する。test-plan は対応不明の行も診断する専用パーサーを使い、Markdown の表と節の解析を共用する。
- 他 change との関係: `add-qa-handoff` の qa-handoff.md は、この対応表の「未保護」「要再確認」を手動確認範囲の入力にできる。`add-flaky-management` の隔離リストに入った TP は、導入後は保護に数えない扱いへ揃える必要がある。`add-e2e-result-publishing` のジョブサマリーへ対応表を載せる連携は、そちらの change で扱う。
- 対象外: テストタグの自動付け替え、main spec への ID 埋め込み、単体テスト等の実行結果のシナリオ単位での照合、未 archive の change を保護に数えること。
