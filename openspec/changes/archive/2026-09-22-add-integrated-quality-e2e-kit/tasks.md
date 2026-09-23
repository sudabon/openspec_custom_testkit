# Tasks

本リストはkit自体を既存 `spec-driven` で実装するためのタスクである。配布する `quality-driven-e2e` のtasks templateとは別物であり、未導入のpolicyをこのリポジトリへ遡及適用しない。利用者向けの承認・seal・反証は全Riskで必須とし、自動検証の承認・sealは隔離fixture内のダミーだけを用いる。

完了条件のV01–V20は design.md「検証計画」を参照する。各実装タスクは対応する失敗fixtureを先に確認し、外から観測できる振る舞いをGREENにする。未実行の検証はチェックしない。

## 1. 出典固定と契約テスト基盤

- [x] 1.1 採用済みQE/E2E SHAの移植対象一覧、MIT表示、OpenSpec fork基準を `docs/upstream-sources.md` と `upstream/manifest.json` に記録する。完了条件: designのSHAと一致し、旧checkoutを変更せず各移植ファイルの由来を辿れる（V19）。
- [x] 1.2 Node package/CLIの最小骨格と隔離target・temporary git repoのtest harnessを作る。完了条件: 公開引数を呼び出せる最小入口があり、期待する未実装の振る舞いをassertionでREDにできる。import失敗だけをREDとしない（V04/V09）。
- [x] 1.3 仕様の全Scenario名を `test/verification-map.md` に列挙し、V01–V20とテスト予定先または文書レビュー先へ対応付ける。完了条件: 6 capability・31 requirement・66 scenarioに対応漏れと重複した正本がない（V01–V20）。
- [x] 1.4 両旧kitのselftest・入力fixtureを移植し、旧schema/CLI/digest/終了コードの互換ケースと統合境界の失敗ケースを分離する。完了条件: baseline結果と既知の誤合格ケースを記録し、期待値を緩和せず新しい失敗ケースを再現できる（V06/V11/V15/V19）。

## 2. 統合スキーマ・テンプレート・役割定義

- [x] 2.1 `quality-driven-e2e/schema.yaml` とproposal/spec/design templatesを作成する。完了条件: schemaの構文と全requiresの辺がdesignのDAGに一致する。残るtemplatesを作る2.2–2.5の後、2.7でschema validateと実CLI検証を行う（V01）。
- [x] 2.2 quality templateとpolicyを作り、Risk/F/O/層、最大risk_level、具体的期待状態、承認欄、oracle_pathsを定義する。完了条件: 全Riskでseal・独立反証必須、high Mutation70%以上、medium/high reviewの条件がschemaとpolicyで一致する（V02/V03）。
- [x] 2.3 test-plan templateに `e2e`、not-applicableのreason/alternative_verification、TP表、全scenario委譲表を定義する。完了条件: requiredと対象外fixtureが同じ契約で読め、Risk/Oracle参照・空計画・層矛盾の負例が明確になる（V03/V14）。
- [x] 2.4 tasks templateをOracle/RED/人間seal → 実装/fixture → TP別E2E → 独立反証/Mutation → evidenceの順で作る。完了条件: 各checkboxに検証条件があり、E2E Oracleの重複実装を指示せず、番号2以降の実装検出と一致する（V02/V03/V10）。
- [x] 2.5 evidence templateの追跡表とExecution Records形式を作る。完了条件: Run-ID、command/time/revision/source、反証、Mutation、review、Residual、再seal履歴の記入例と欠落例があり、未実行と成功を区別する（V12/V13）。
- [x] 2.6 製品非依存Oracle writer/Falsifier roles、Claude adapters、E2E規約とfixtureガイドを整備する。完了条件: 入力allowlist、期待値にdesign/実装会話を混入しない制約、独立セッション引継ぎ、人間専用操作をレビューで確認できる（V02/V03）。
- [x] 2.7 旧quality-driven/spec-driven-e2eを互換用に配置し、統合schemaの通常/skip_specsで実CLIを検証する。完了条件: 三schemaのvalidateが成功し、design/test-planの独立した依存がstatusに現れる。旧changeに新成果物を要求せず、skipでは架空specを作らず、統合apply入力に全計画が入りevidenceなしでreadyになる（V01/V19）。

## 3. 共通メタデータと対象判定

- [x] 3.1 YAML parserの版・licenseを固定してvendor bundleと再生成手順を整備し、config/frontmatterを共通解析する。完了条件: quotes/list/comment/重複key/破損の正負例が通り、pack用bundleが導入先の依存追加なしに読み込める（V05/V09/V18）。
- [x] 3.2 repo root・base-ref・metadataを扱う共通selectorを実装する。完了条件: 全schemaと混在、明示change不在、判定不能、不正refを区別し、working-directoryから独立して対象を返す（V09/V17）。
- [x] 3.3 archive移動、rename検出なしの移動、純削除、統合metadata削除を比較元/HEADの両方から解決する。完了条件: 元idを維持し二重検査せず、削除や破損で統合finalを迂回できない（V09/V10）。
- [x] 3.4 統合適用状態、旧schema fallback、QE_SCHEMA/QE_SEAL_REQUIRED_LEVELSの優先順位を実装する。完了条件: 旧入力を保持しつつ統合全Riskの検査は無効化できず、unknownとnot-applicableを区別する（V02/V09/V14）。

## 4. インストーラと安全な移行

- [x] 4.1 install/updateの引数互換、操作計画、dry-runを既存実装から統合する。完了条件: init前/後、別target、無変更update、dry-runのbyte/mode/stamp比較が成功し、既存終了コードを維持する（V04）。
- [x] 4.2 config/schema/contextの最小マージと保護ファイル処理を実装する。完了条件: language/rules/他marker/独自追記を保持し、旧marker移行後も冪等、forceでもpolicyと実Playwright configを上書きしない（V05）。
- [x] 4.3 E2E rootの優先順位と配布内容のpath変換を実装する。完了条件: 旧stamp、複数config、monorepo、明示root、動的設定の診断、配置先変更時の旧file保持が検証できる（V07）。
- [x] 4.4 target境界・symlink・store・OpenSpec版を全書込み前に検査する。完了条件: 危険pathと外部storeはforceでも書込みゼロで拒否し、CLIなしや未対応版はreadyと誤報告しない（V07/V08）。
- [x] 4.5 旧版hash/変換後内容照合と新stampを実装する。完了条件: QEのみ/E2Eのみ/両導入順で既知未編集だけを移行し、独自編集・未知版を保持、旧stampと進行中 .openspec.yamlを変更しない（V06/V19）。
- [x] 4.6 未移行一覧・復旧案内とdoctorを実装する。完了条件: 必須gate/common moduleの更新漏れをincompleteとし、install終了0でもdoctorが拒否でき、修復後にcompleteへ進む（V06/V18）。
- [x] 4.7 shell権限とhidden payloadの追跡設定を整備する。完了条件: 必要fileが実行可能で、`git check-ignore` とpack一覧で `payload/.claude/` が脱落せず、利用者の無関係なignore規則を保持する（V18）。

## 5. QE・証跡・archiveゲート

- [x] 5.1 qe-gateの既存入口を共通判定へ接続し、quality/tasks/承認/Risk最大値を検査する。完了条件: 計画途中と未承認タスク進行を区別し、欠落quality、不正Risk、統合approved_at不正を拒否する（V09/V11）。
- [x] 5.2 統合Oracle manifest/digestと人間seal入口を実装する。完了条件: 全Riskでseal前実装を拒否し、空集合・内容変更・追加・削除・renameを検出する。旧digestのgolden caseを維持する（V02/V11/V19）。
- [x] 5.3 evidenceの構造・ID参照・runの整合検査を実装する。完了条件: Risk文字列だけの証跡、必要項目欠落、source hash/revision不一致を拒否し、構造確認と実行確認を分けて表示する（V13）。
- [x] 5.4 全Riskの反証記録、反例/Residual、medium/high review、high Mutation結果を検査する。完了条件: low反証欠落、未承認Residual、必要review欠落、Mutation未指定/未実行/閾値未達がそれぞれ失敗する（V12）。
- [x] 5.5 統合 `check --phase plan|final` とarchive最終検査を実装する。完了条件: archiveでも承認・seal・未完了task・quality・Risk・証跡を再検査し、旧形式へ新JSON成果物を要求しない（V10/V13/V19）。

## 6. E2E計画・タグ・レポータ

- [x] 6.1 check-test-planをschema別に適用し、全scenario割当とRisk/Oracle/TP参照を検査する。完了条件: required/not-applicableの正常例、理由/代替欠落、層矛盾、空TP、重複ID、未割当scenarioの異常例が通る（V03/V14）。
- [x] 6.2 タグ存在検査と結果照合をchange+TP-IDの完全一致に統一する。完了条件: 同一TPの別change、prefix類似id、正規表現文字の負例で不足を誤って補完せず、タグだけでは実行coverageにならない（V15）。
- [x] 6.3 レポータの実attempt/status処理を修正する。完了条件: pass/fail/skip/0/flaky/unknown/attemptなしと複数projectのfixtureを正しく分類し、失敗3が欠落1より優先する（V15）。
- [x] 6.4 JSON入力・時刻・max-ageと実行単位の出力を検査する。完了条件: 欠落/不正/古い/時刻なしを適切に2とし、旧引数と時刻表示を維持、前回成功を今回未実行に流用できない（V16）。
- [x] 6.5 旧E2E planとreporterの互換テストを更新する。完了条件: 新frontmatterを要求せず終了コード0/1/2/3とflaky表示を維持し、誤合格に依存したfixtureは正しいchangeタグに直して仕様の不足検出を残す（V15/V19）。

## 7. CIと実行結果の伝達

- [x] 7.1 新reusable workflowに版・base-ref・working-directory・setup-mode・各command・base URL・鮮度入力を定義する。完了条件: workflow構文検査と入力fixtureでrepo root検出、npm/caller準備、未対応環境診断を確認できる（V17）。
- [x] 7.2 plan/finalの呼出しとrun manifest・固有report directory・結果artifactを接続する。完了条件: 完了宣言・archiveはplan指定でもfinal検査され、gate/Oracle/E2E/report/Mutationの失敗を一つずつ注入して保存処理後も最終jobが失敗するlocal harnessが通る（V16/V17）。
- [x] 7.3 change差分なしとnot-applicableでも回帰テスト・構成済みsmokeを実行する。完了条件: required混在/全対象外/差分ゼロで必要なテストが残り、無効refを空集合に変換しない（V09/V14/V17）。
- [x] 7.4 npm単純構成、caller setup、monorepo、E2E不要、high Mutation、webServer/既存serverのCI例を作る。完了条件: 必要runtime/browser/DB/serverの担当と旧workflowから変える参照先・inputsが例ごとに確認できる（V17/V19）。

## 8. 実統合smokeと文書

- [x] 8.1 localhostの最小fixture app、独立したOracleテスト、TPタグ付きPlaywrightテスト、fixture READMEを整備する。完了条件: 承認はダミーと明記し、OracleのRED理由と正常fixtureのGREEN、状態変化の観測を確認できる（V20）。
- [x] 8.2 requiredの統合smokeを実行し、Oracle → Playwright → reporter → evidence finalを通す。完了条件: 実browser結果、TP coverage、Run-IDと対象revisionの証跡が繋がり、意図的失敗が最終検査まで伝達する（V20）。
- [x] 8.3 E2E不要のfixtureとrequired混在fixtureを実行する。完了条件: 理由・代替Oracle結果・全Riskのseal/反証を検査し、対象外が他changeやsmokeを無効にしない（V14/V20）。
- [x] 8.4 README、architecture、workflow、migration、compatibilityを日本語で完成させる。完了条件: 導入/更新、承認/seal/独立セッション、旧policyとの差、移行/戻し方、store制約、保護の限界、CLI/終了コード、対応版をspecと照合できる（V19）。
- [x] 8.5 全Scenarioの検証索引と実施結果を照合し、見つかった反例を修正または人間判断が必要な残留リスクとして提示する。完了条件: V01–V20の漏れと未実行を一覧化し、テスト緩和や架空の承認で閉じていない（V01–V20）。

## 9. 配布・互換性・最終検証

- [x] 9.1 lint/test/smokeコマンドと必要なCIのOS/Node行列を整備する。完了条件: Node20/22・macOS/Linux・OpenSpec1.13.1を明示し、CLI/browser不足を必須検証の成功skipにしない（V01/V19）。
- [x] 9.2 `npm run lint`、`npm test`、`npm run test:smoke` を実行する。完了条件: 必須チェックが成功し、コマンド・版・時刻・失敗/skip数を記録する（V01–V20）。
- [x] 9.3 `npm pack --dry-run` と実tarball導入を検証する。完了条件: CLI/payload/vendor/roles/licenseが揃い、不要checkoutを含まず、隔離targetでinstall/updateとdoctorが動く（V18）。
- [x] 9.4 導入先で `openspec update` と旧change継続を検証する。完了条件: 独自schema/roles/scriptsを保持し、生成コマンドを直接変更せず、旧schemaのstatus/instructions/applyが成立する（V01/V18/V19）。
- [x] 9.5 macOS/LinuxとNode20/22の実測結果を取得して対応表に記録する。完了条件: 必須行列の結果を取得し、取得できない行は未検証としてこのタスクを未完了に残す。hosted CIをローカル結果で代用しない（V19）。
- [x] 9.6 OpenSpec strict validate、Git差分、検証索引、完了条件を照合して実装結果を報告する。完了条件: tasksが実際の結果と一致し、未検証GitHub導入/公開、互換性への影響、残留リスクと必要な人間操作を明示する。push/公開/旧repo変更は行わない（V01–V20）。
