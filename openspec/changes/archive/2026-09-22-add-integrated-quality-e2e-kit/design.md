# Design

## Context

目的・初期範囲は proposal.md とブリーフを参照する。本 change は開発リポジトリの `spec-driven` で計画し、配布する `quality-driven-e2e` を自身の開始条件にしない。

2026-09-22の調査で、このリポジトリには README、LICENSE、ブリーフ、OpenSpec設定があり、製品コード・package.json・lint/testコマンド・既存specはないことを確認した。利用者作成の `.gitignore` は `.claude/` 等を広く除外しているため、実装時には `payload/.claude/` の追跡漏れを検査する。今回この設定は変更しない。

### 採用元と観測結果

| 対象 | 採用SHA / 調査方法 | 再利用と変更点 |
|---|---|---|
| [QE kit](https://github.com/sudabon/openspec_quality_kit/tree/e537d10da53112fce684f31d1602c1e061ab87a2) | `e537d10da53112fce684f31d1602c1e061ab87a2`。cleanなローカルcheckoutとGitHub HEADが一致 | installのdiff/seed保護、quality schema、roles、selftestを継承。gateは単一QE_SCHEMA、archiveは主にtasksとRisk文字列検査、空directoryもdigest化するため強化する |
| [E2E kit](https://github.com/sudabon/openspec_e2e_test/tree/53e354fa366f02cf412e9ce93419463a37e8255c) | `53e354fa366f02cf412e9ce93419463a37e8255c`。GitHub HEADとブリーフが一致し、そのtarballを一時directoryで調査 | installのE2E root解決・context移行、schema、規約、reporter、selftestを継承。checkerのschema非区別、reporterのchange未絞込みとskip計上を修正する |
| E2Eローカルcheckout | `7abd8bf9c73cce97a3afeb9b989d37c5a7486494` | 指定SHAのオブジェクトがなく、採用元に使用しなかった。旧checkoutには変更しない |
| OpenSpec | ローカルCLI `1.13.1` | 開発用schemaはspec-driven。両kitのfork基準と合う。status / instructions の存在判定だけで品質承認済みとはしない |
| ライセンス | 両kitともMIT、Copyright (c) 2026 sudabon | コピー元とライセンスを保持。新規実装と移植部分を区別して出典化する |

両kitの `install.mjs`、README、package.json、schema/templates、gate/reporter、workflow、selftest、LICENSEを確認した。QEのpolicyはlowのseal・反証を任意とするが、tasks instructionは一律要求している。**ユーザーの決定により統合版では両方とも全Risk必須**とする。旧schemaは凍結した互換形式として扱う。

既存E2E reporterは終了コード0/1/2/3、`--max-age`、flaky表示を持つが、全suiteのTP-IDを集計し、skipもexecutedに含める。修正後も呼出し・コードの意味を保持し、誤った合格を正常互換として固定しない。旧fixtureで別changeの結果を流用していた期待値は、正しいchangeタグに修正し、失敗・不足・鮮度の契約を維持する。

## Goals / Non-Goals

**Goals:**

- 判定・メタデータ解釈を共有し、schema、template、policy、gate、CI間のズレを検出可能にする。
- 旧形式の継続と新形式の厳密な検査をschema単位で分ける。全Risk必須の統合基準を旧policyや環境変数で迂回させない。
- CLIと実行結果を外から観測するテストを中心にし、macOS/Linuxの差、空集合、破損状態、移行途中を検証する。

**Non-Goals:**

- 今回の計画フェーズでは製品実装・実承認・seal・公開操作を実施しない。
- store対応、汎用テスト環境の自動構築、改ざん不能な承認基盤、旧URLの置換、古いchangeの一括変換は実装しない。
- このbootstrap changeへ未導入のquality policyを遡及適用しない。利用者向けゲートは隔離fixtureで開発する。

## Decisions

### 1. 一つの製品とschema単位の互換境界

独立した二つのinstallを順番に呼ぶ案は採用しない。共通ファイルの衝突と対象判定が残るためである。旧schemaを統合schemaのaliasにする案も、旧changeに新成果物を要求するため採用しない。

新しい `install.mjs` が三つのschema、共通検査、roles、E2E規約を配布する。Node標準ライブラリのfile/path/crypto/child_processを基本とし、旧installの引数・diff・root変換処理を小さなモジュールに分離して再利用する。配置はブリーフ§9を基本とし、共通gate処理は `payload/scripts/lib/`、製品非依存rolesは `payload/openspec/roles/`、旧版照合用情報はkit内の `upstream/manifest.json` とする。

### 2. YAMLを正規表現だけで判定しない

quoted scalar、list、comment、重複key、破損frontmatterを扱うため、`yaml` v2のDocument APIを使用する。コメントと文書構造を扱えるAPIは[公式資料](https://eemeli.org/yaml/)で確認した。パーサを手作りする案は、unknownを対象外に誤変換するリスクが高い。

追加依存はこの解析目的に限定する。実装時にNode 20互換版をlockfileで固定し、build用bundleツールで `payload/scripts/lib/vendor/yaml.mjs` に同梱する。installも配布gateも同じ同梱物を参照し、導入先のpackage.jsonへ依存を追加しない。元ライセンス（ISC）を同梱し、再生成diffとpackで欠落を検出する。使用APIは公開APIに限定する。

config編集はparserで意味を検査したうえでschema値・管理context範囲だけを更新する。無関係部分のbyteを保持できる通常形を優先し、特殊tag・aliasなど安全な編集ができない形は保持して診断する。frontmatterの重複key・型不正はエラー。`config.yaml` を優先し、不在時だけ `config.yml` を読む。両方を別々の正本にしない。

### 3. 統合DAGと適用状態

| Artifact | requires | 出力 |
|---|---|---|
| proposal | なし | proposal.md |
| specs | proposal | specs/**/*.md |
| quality | specs | quality.md |
| design | proposal, quality | design.md |
| test-plan | specs, quality | test-plan.md |
| tasks | specs, quality, design, test-plan | tasks.md |

`apply.requires: [tasks]` とし、evidenceはtemplateのみ提供する。apply instructionsのcontextFilesに全計画入力が含まれることを実CLIで検査する。designは期待値の正本ではなく、test-planから依存させない。

統合test-planはfrontmatterの `e2e: required | not-applicable` を唯一の適用宣言にする。qualityには同じ適用flagを置かず、Oracleと層選択を持たせ照合する。`not-applicable` はfrontmatter `reason` と `alternative_verification`（Oracle ID、層、検証方法のlist）を必須とし、本文に全scenarioの委譲表を置く。`required` はTP行を1件以上必要とする。unknown、missing、不正値は対象外にしない。

TP表の固定列は `TP-ID / Requirement / Scenario / Risk / Oracle / Fixture / Intent / Expected`。参照はcapability pathとRequirement・Scenario名の組で解決し、重複TP-ID、存在しないRisk/Oracle、未割当scenarioを検出する。qualityの表は既存のRisk Register、Failure Modes、Test Oracles、Test Layer Mappingを維持する。統合templateには各表の必須列を明示し、genericなMarkdown中の文字列探索で判定しない。

`skip_specs: true` ではOpenSpecのskipped状態を尊重し、specファイルを生成しない。quality/test-plan instructionはproposalと変更範囲を読むfallbackを持つ。仕様変更なしという理由と代替検証を明示し、低Riskでも承認・seal・反証は残る。通常とskipの両方でstatusとinstructionsを実行し、未検証のCLI挙動を前提に完了を宣言しない。

### 4. 全Riskの人間ゲートと旧policy保持

| Gate | 統合low | 統合medium | 統合high |
|---|---|---|---|
| quality承認 | 必須 | 必須 | 必須 |
| Oracle seal | 必須 | 必須 | 必須 |
| Static / 型 / Lint（適用するもの）・Oracle | 必須 | 必須 | 必須 |
| 独立反証 | 必須 | 必須 | 必須 |
| Mutation | 不要 | 任意 | 必須、初期70%以上 |
| Human Code Review | 任意 | 必須 | 必須、ドメイン担当を含む |
| E2E | 層選択に従う | 層選択に従う | 層選択に従う |

既存 `openspec/quality-policy.md` はforceでも保持する。統合schema自身に上表を最低基準として持たせ、プロジェクトpolicyのより厳しい条件を加える。旧low任意policyを検出したら、統合schemaの最低基準との差分を表示し、人間向けの追記例を案内する。旧schemaのlowは既存policyに従い、強い新基準を遡及要求しない。

`QE_SEAL_REQUIRED_LEVELS` は旧schema互換用として保持し、統合版の必須sealは解除できない。`QE_SCHEMA` は旧追加対象の選択にのみ適用し、統合schemaを常に対象に含める。明示的な旧schema指定は維持するが、新統合契約を抜け道にしない。

Oracle writerとFalsifierはrolesに入力allowlist・禁止事項・出力を定義し、Claude adapterはその定義を参照する。Codex専用設定を初期版に追加せず、独立セッションへの引継ぎを標準手順として提供する。入力bundleを作る場合、会話履歴やdesignを含めず、TP-IDは根拠を増やさない対応表だけに限定する。

### 5. インストールの計画・書込み・移行判定

処理順は引数解析 → target/store/pathの事前確認 → 全操作計画 → 差分表示 → 書込み → 結果/stampとする。dry-runは同じ計画を使い書込み段階を実行しない。危険なpathはforceでも拒否する。symlinkは既存親directoryのrealpathまで検査し、未作成子directoryも正規化したtarget内に限定する。

比較する内容はE2E root変換後のbyteとする。新stampには `version`、`installedAt`、`e2eRoot`、`files`（導入した内容hash）、`migration.status: complete | incomplete`、`migration.pending`、採用元SHAを記録する。同一版・内容のno-opでは時刻を書き換えない。既知旧版はmanifest内の基準ファイルに同じroot変換を適用して照合し、完全一致だけを自動移行できる。未知版は保持する。

既存CLIと同様、独自編集をskipしたinstallは終了0を維持するが、**0は処理正常終了であり統合完了とは限らない**。出力とstampにincompleteを明示し、新しい `node scripts/testkit-gate.mjs doctor` が必須gate・共通module・policy互換を検査して未移行を非ゼロにする。install終了コードは0正常・1実行失敗・2引数不正、旧gate/reporterのコードも保持する。

旧stampは読取りのみ。root解決は `--e2e-root` > 新stamp > 旧E2E stamp > Playwrightの静的testDir > 既存directory > tests/e2e。深さ3までの設定探索、浅さ・名前順は継承する。動的なconfigは実行せず、検出できない場合の根拠と明示指定を案内する。壊れたstampによって黙ってrootを移動させず、診断して修正または明示指定を必要とする。

store宣言はconfigから検出する。OpenSpecがある場合はtargetをcwdに `context --json` を確認し、global defaultStoreや外部rootも拒否する。CLIがなくstore解決を確認できない場合、repo-local準備だけと明示し、doctorのOpenSpec確認が済むまで統合readyを保証しない。store検出時にローカルrootを代替作成しない。

### 6. 共通対象判定と実行フェーズ

`payload/scripts/lib/` にrepo root、metadata、git差分、applicability、診断を共有する。shellはbash 3.2互換の薄い入口にし、集計・hashはNodeで行ってGNU sort -z等への依存を避ける。

統合入口は `node scripts/testkit-gate.mjs` に `doctor`、`select [--base <ref>] [<change>...] --json`、`check --phase plan|final [--base <ref>] [<change>...]` を提供する。既存入口の引数は変えず、qe-gateはQE、check-test-planは計画/タグ、e2e-reportは実行結果を担当する。

- `plan`: 計画途中は状態を表示する。tasksができた後はquality/test-plan整合を検査。未承認かつ全タスク未完了は計画状態、チェック済みタスクがあれば違反。番号2以降が完了した統合changeはseal必須。
- `final`: 実行済みの完了条件、反証、Mutation、review、証跡、全tasks完了を検査する。archive移動は明示指定がなくてもこの段階で検査する。
- 判定結果は `id / path / schema / lifecycle / qe / e2e / reason / errors` を含む。lifecycleはactive / archived / deleted、E2Eはrequired / not-applicable / unknown。unknownは成功の対象外でない。

比較元は `git merge-base <base> HEAD` を確定してからNUL区切りのname-statusを取得し、両revisionのmetadataを読む。archiveのdate接頭辞と元idを照合し、rename検出の有無によらず移動を対応付ける。純削除・schemaの判定不能・比較元失敗は診断し、統合finalは失敗する。旧形式でmetadata未記載の場合は旧kitで認めていたconfig fallbackを限定的に保持するが、比較元が統合だったchangeには使わない。

changeなしは正常な空集合として返し、回帰テストの要否とは分ける。対象選択を回帰テストの代用品にしない。

### 7. Sealと構造化evidence

旧schemaのdigest方式は互換adapterで維持し、既存sealを無効にしない。統合schemaはroot相対pathを正規順に並べ、path長・path・content hashの明確な境界を持つmanifestをhash化する。ファイル集合0件を拒否し、directory内の追加・削除・renameもmanifest差分になる。sealサブコマンドは人間専用、fixture内の呼出しは擬似承認と記録する。

統合evidence本文は `Risk / Failure Mode / Oracle / Layer / TP-ID / Result / Run-ID` の追跡表を持つ。機械検査用の `## Execution Records` のJSON fenced blockを正本にし、`format_version: 1`、`runs`（id、command、started_at、revision、exit_code、source、source_sha256）、`risk_results`（risk、failure_modes、oracles、layer、tp_ids、result、run_ids）、`falsification`、`mutation`、`reviews`、`oracle_changes`、`residuals` を保持する。不要項目は空配列と理由、未実行は明示値とする。本文との不一致を許容しない。

sourceはrepo内またはCIが取り込んだrun固有artifactの参照とし、任意の外部URLを自動fetchしない。runのhash・revision・実行コード、TP結果を照合する。構造が揃うだけでは任意コマンドの真実性を証明できないため、CI実行記録の検証状態を別に表示する。人間承認の本人性も同様にCODEOWNERS・branch protectionの運用に依存する。

Mutationはコマンドの非ゼロ終了で閾値未達を反映させ、evidenceにはscoreとthreshold（統合highは最低70、project基準が高ければその値）を記録する。command未指定、結果欠落、score不正を成功にしない。旧evidenceは既存表の必要項目で検査し、新JSON形式は要求しない。

### 8. E2Eレポータと正確な識別

旧引数と出力表を維持し、schemaに応じて統合planまたは旧planを読む。旧spec-driven-e2eはe2e keyなしでrequiredと解釈する。change tokenとTP tokenを完全一致で照合し、title内tagも境界を検査する。Playwrightの選択は正規表現escapeとtoken境界を適用し、結果側でも再照合する。

coverageは実attemptがあるexpected/flakyの組だけ。skip、unknown、attemptなしは不足、unexpectedは失敗。複数projectでは各結果を表示し、一つの失敗を他projectの成功で隠さない。requiredの計画0件も欠落として扱う。

終了判定順は入力/鮮度エラー2 → 対象テスト失敗3 → coverage欠落1 → 成功0。--max-age未指定の旧CLI呼出しは鮮度による拒否を増やさず時刻を表示する。統合CIは毎回新規run directoryへJSONを出力し、開始時刻・revisionを記録したrun manifestと照合する。前回のファイルを削除せず別directoryに分離し、今回の欠落を確実に検出する。

### 9. CIの提供形態と実行契約

新reusable workflowは `.github/workflows/openspec-custom-testkit-gate.yml`。旧URLは変更しない。入力は `openspec-version`（初期1.13.1）、`node-version`、`working-directory`（既定 .）、`base-ref`（既定origin/main）、`gate-phase: plan | final`（既定plan）、`setup-mode: npm | caller`、`setup-command`、`test-command`、`mutation-command`、`e2e-command`、`e2e-base-url`、`report-max-age` とする。出力は既存QEと同じ意味の `risk-level` と検査結果artifact。

- npm mode: lockfileを検査してnpm ci。E2E実行時はChromium依存を準備する。
- caller mode: 同じjob内のsetup-commandでruntime、pnpm/yarn、依存、browser、必要DBを準備する。別jobの環境が引き継がれるとは想定しない。高度なservicesは利用者workflowへの組込み例を提供する。
- test-commandはOracle/代替検証を含み、最終検証では空を許さない。highはmutation-command必須。E2E不要でもtest-commandは動く。
- e2e-commandはPlaywright JSONとrun directoryへの出力を契約とする。required対象とsmokeを実行し、requiredがなくても構成されたsmokeを実行する。E2E基盤自体を持たない構成はその旨を明示し、回帰テストを動かす。
- サーバーはPlaywright webServerで準備する例を標準にし、既存サーバー利用ではURL到達性、fixture初期化/片付けの責任を利用者に置く。
- commandはenv経由で信頼されたworkflow設定から渡す。base-refもshell断片に埋め込まない。PRタイトル等はコマンドに使用しない。
- 実行コードを保存してレポート・artifactを出力した後、元の失敗を集約して非ゼロ終了する。`|| true` で最終成功へ変換しない。

計画PRはplan gate、完了・archive検証はfinal gateとし、未実行の計画を実行済みと評価しない。全tasks完了を宣言したchangeとarchive移動は、gate-phaseがplanでも自動的にfinalへ昇格させる。workflowの最終完了検証と利用者のarchive前操作を文書で結び付ける。

### 10. 検証計画

今回の計画成果物に別schemaのquality/test-planを追加しない。以下を本bootstrap changeの検証計画とし、製品のtemplate/fixtureのquality/test-planと区別する。仕様の全Scenario名を検証索引に列挙し、各テストまたは文書レビューへ割り当てる。表中の範囲を理由にspecのScenarioを省略しない。

| ID | 対応capability | 検証対象と期待する観測 | 層 |
|---|---|---|---|
| V01 | integrated-quality-workflow | 実CLIでDAG、instructions入力、apply readiness、evidence非依存、通常/skip_specs | Integration |
| V02 | integrated-quality-workflow / quality-evidence-gates | low/medium/highで承認・seal・反証必須、旧policy/環境変数の迂回不可、役割入力と人間専用操作 | Contract + role文書レビュー |
| V03 | integrated-quality-workflow / e2e-plan-reporting | 全scenario割当、Risk/F/O/TP参照、unit OracleはTP不要、E2E Oracle重複なし | Unit + template fixture |
| V04 | safe-kit-installation | init前/後、別target、再install、update、dry-run。内容hash・mode・stamp比較 | CLI Integration |
| V05 | safe-kit-installation | language/context/rules/marker、policy、実config、独自編集、force、危険YAML保持 | CLI Integration |
| V06 | safe-kit-installation | QEのみ/E2Eのみ/両順序、旧stamp、既知/未知hash、未移行gateとdoctor失敗 | CLI Integration |
| V07 | safe-kit-installation | 複数config、monorepo、明示root、root変更、動的config、path逸脱・symlink・壊れたstamp | CLI Integration |
| V08 | safe-kit-installation | store宣言/global default、CLIなし、古いOpenSpecの診断。外部書込みなし | Integration |
| V09 | change-gate-selection | 各schema、混在、対象なし、metadata破損、QE_SCHEMA、prefix、不正ref | Unit + temporary git repo |
| V10 | change-gate-selection / quality-evidence-gates | archive rename、delete、番号/checkbox揺れ、欠落quality、不正Risk、未完了task | git + gate Integration |
| V11 | quality-evidence-gates | 承認未記入/日時不正、Risk最大値、全Risk seal前実装、空Oracle、変更/追加/削除/rename、再seal履歴 | Gate Integration |
| V12 | quality-evidence-gates | 全Risk反証、反例とResidual受容、medium/high review、high Mutation未指定/閾値未達 | Gate Integration |
| V13 | quality-evidence-gates | Risk文字列のみ・必要列欠落・run参照切れ・hash/revision不一致を拒否、構造と実行検証を区別 | Unit + Integration |
| V14 | e2e-plan-reporting | required/not-applicable、不明flag、空TP、理由/代替欠落、quality矛盾、タグ存在と未実行の区別 | Gate Integration |
| V15 | e2e-plan-reporting | pass/fail/skip/0/flaky/unknown/attemptなし、他change同一TP、複数project、終了コード0/1/2/3 | Reporter fixtures |
| V16 | e2e-plan-reporting | JSON欠落/不正/古い/時刻なし、max-age互換、前回成功後に今回JSON生成失敗 | Reporter + run harness |
| V17 | ci-distribution-contract | base-ref、working-directory、npm/caller setup、browser/DB/server責務、command欠落、失敗伝達、対象なし回帰 | CI契約 + local harness |
| V18 | ci-distribution-contract | npm pack→隔離install、payload/hidden roles/vendor/license、実行権限、不要checkout除外、openspec update耐性 | Distribution Integration |
| V19 | safe-kit-installation / ci-distribution-contract | Node20最低基準・Node22検証行列、macOS/Linux、旧schemaと旧CLIの正規ケース、移行/戻し方・出典文書 | Compatibility + docs |
| V20 | 全capability | 承認済みfixtureのOracle→実装済みfixtureの実Playwright→reporter→evidence final、E2E不要fixtureの代替検証 | 実E2E smoke |

V20ではlocalhost上の最小fixture appを使い、外部送信しない。ダミー承認はfixtureに限定する。browser失敗、JSON未生成、not-applicableとrequiredの混在も同じharnessで失敗伝達を確認する。fixtureの合格を実プロジェクト承認の証拠にはしない。

実装時に `npm run lint`（Node構文、shell、YAML/schema、必要なstyle検査）、`npm test`（移植selftestとunit/integration）、`npm run test:smoke`、`npm pack --dry-run` とtarball実導入を整備する。OpenSpec CLIやbrowserがない場合、必須検証をskipした成功にはせず未検証として報告する。旧テスト件数の維持だけでは網羅としない。

## Risks / Trade-offs

- [旧schemaに元からあるpolicy/instructionの不一致] → 原版を互換用に保持し、統合との差を明示する。旧利用者の判断を自動で弱めたり強めたりしない。
- [既存policy保持と統合全Risk必須の差] → schemaの最低基準を優先し、保護したpolicyに必要な人間の追記を提示する。
- [YAML依存とbundleによる配布負担] → parser一つに限定し、lock・再生成・ISC表示・pack検査で追跡する。導入先の依存設定は変更しない。
- [人間の本人性と実行記録の改ざん] → sealはpath/contentの整合検査であり本人性の証明ではない。CODEOWNERS、branch protection、CI artifact保存の責任を説明する。
- [copy途中のIO失敗] → 個別fileは一時fileから置換し、完了stampを最後に更新。失敗を非ゼロとし、再実行とGit rollbackを可能にする。target全体のtransaction保証はしない。
- [Playwright動的設定や特殊YAMLの自動解釈限界] → 設定を実行せず、保持・根拠表示・明示指定へ誘導する。
- [OS/Node/OpenSpecの版差] → Node20/22とOpenSpec1.13.1の検証結果を記録し、未実行の組合せを保証しない。計画時のローカルNodeは23.7.0であり最低版検証ではない。
- [ホストCI・GitHub導入未検証] → ローカル結果と分離する。push/公開は別依頼の範囲とし、GitHub経由npx未検証でもpack検証結果だけを正確に報告する。

## Migration Plan

1. 利用者が既存config、scripts、policy、stamp、Playwright設定をGit commit等で保全する。kitは旧repoや進行中changeを改変しない。
2. 新CLIのdry-runで既知版照合、root、schema保持、必要差分と未移行候補を確認する。
3. install/updateで配布物を配置する。既存policyと実configは保持し、独自編集は差分を利用者が統合する。forceでも保護例外は変わらない。
4. doctorとplan gateを実行し、未移行gate・設定差を解消する。新changeに明示的にquality-driven-e2eを指定して実フローを確認する。
5. 旧workflowから新workflowまたは組込み例へ参照先・inputsを変更し、利用者が必要な環境準備とCODEOWNERS運用を確認する。既定schemaの切替は利用者が明示的に行う。
6. 戻す場合は保存した版・config・workflow・scripts・stampをGitで復元する。新CLIが作った新規fileは一覧と照合して利用者が削除し、旧配置や進行中changeを自動削除しない。旧GitHub URLは存続する。

## Open Questions

- OQ-01: GitHub経由npx導入とhosted Actionsの実測結果は公開/実行後に記録する。今回は公開操作を行わず、ローカルtarballとworkflow契約の検証を必須とするため実装範囲は変わらない。
- OQ-02: 実装時に利用できるmacOS/Linux実行環境とNode20/22の実測結果を確認する。検証行列は固定し、不足環境は未検証として残す。未実行の必須タスクを完了扱いにしない。
