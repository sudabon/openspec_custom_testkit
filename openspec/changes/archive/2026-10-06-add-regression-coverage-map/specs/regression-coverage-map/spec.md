# Spec Delta

## Purpose

main spec の全シナリオが、どの E2E テストまたは他層の代替検証で守られているかを一覧にする。保護されていないシナリオ、仕様変更で古くなった対応、削除済み仕様を指すテストを区別して示し、QA が手動回帰テストを減らす判断の根拠にする。

## ADDED Requirements

### Requirement: Scenario coverage map across main specs
システムは `openspec/specs` 配下の全 capability の全 `#### Scenario:` を、capability のパスとシナリオ名の組をキーとして列挙しなければならない（SHALL）。各シナリオには、archive 済み change の test-plan.md から対応する行を集めて割り当てなければならない（SHALL）。TP 行は E2E 保護、`## 対象外シナリオ` 行は Layer と Method を伴う他層の宣言として扱わなければならない（SHALL）。test-plan の行がどの capability に属するかは、同じ change の delta spec でそのシナリオを含むファイルのパスから決めなければならない（SHALL）。テストのタグを付け替えてはならない（MUST NOT）。

#### Scenario: Scenario protected by an archived TP
- **WHEN** main spec にあるシナリオが、archive 済み change の test-plan の TP 行で割り当てられている
- **THEN** 対応表はそのシナリオを「保護（E2E）」とし、change id と TP-ID を表示する

#### Scenario: Scenario delegated to another layer
- **WHEN** main spec にあるシナリオが、archive 済み change の `## 対象外シナリオ` 行だけで割り当てられている
- **THEN** 対応表はそのシナリオを「保護（他層の宣言）」とし、Oracle、Layer、Method を表示する
- **AND** 実行結果を照合していない宣言であることを表示する

#### Scenario: Scenario without any mapping
- **WHEN** main spec にあるシナリオが、どの archive 済み change の test-plan にも割り当てられていない
- **THEN** 対応表はそのシナリオを「未保護」とする

#### Scenario: Same scenario name in two capabilities
- **WHEN** 同じシナリオ名が二つの capability に存在し、test-plan の行は一方の capability の delta spec にだけ対応する
- **THEN** 対応表はその行を delta spec が属する capability にだけ割り当て、もう一方を保護に数えない

#### Scenario: Active change is not protection
- **WHEN** 未 archive の change の test-plan だけがシナリオを割り当てている
- **THEN** 対応表はそのシナリオを保護に数えず、進行中の change があることを補足として表示する

#### Scenario: Malformed active change is only a warning
- **WHEN** 進行中 change の YAML・delta 見出し・コードフェンスなどに不備がある
- **THEN** その change だけを進行中の注記から除外し、change と理由を警告として表示する
- **AND** 他の change の対応表を出力し、この警告だけでは strict の有無によらず失敗しない
- **AND** I/O エラーや予期しない内部例外は入力書式の警告として握りつぶさない

### Requirement: Stale and orphaned coverage detection
システムは、対応する TP または他層の宣言（対象外行）より後に archive された change の delta spec で、そのシナリオを含む Requirement が ADDED・MODIFIED・RENAMED で再定義されている場合、その対応を「要再確認」と分類しなければならない（SHALL）。前後関係は archive フォルダの日付と名前の順で決めなければならない（SHALL）。より新しい change が同じシナリオへ TP または対象外行を割り当てていれば、古い対応では要再確認にしてはならない（MUST NOT）。main spec に存在しないシナリオを指す TP は「孤立」と分類しなければならない（SHALL）。要再確認と孤立を保護に数えてはならない（MUST NOT）。

#### Scenario: Requirement modified after the TP was written
- **WHEN** change A の TP がシナリオ S を守り、その後に archive された change B が S を含む Requirement を MODIFIED し、B の test-plan は S に TP を割り当てていない
- **THEN** 対応表は S を「要再確認」とし、A の TP-ID と B の change id を表示する

#### Scenario: Requirement modified after a delegated declaration
- **WHEN** change A の対象外行がシナリオ S を他層で守ると宣言し、後の change B がその Requirement を MODIFIED し、新しい対応を割り当てていない
- **THEN** S を「要再確認」とし、A の宣言と B の change id を表示する

#### Scenario: Requirement redefined by ADDED or RENAMED
- **WHEN** TP または対象外行の archive より後の change が同じ Requirement 名を ADDED または RENAMED の TO として再定義し、新しい対応を割り当てていない
- **THEN** 古い対応は「要再確認」となり、実際の操作名を表示する

#### Scenario: Quality-driven delta invalidates older coverage
- **WHEN** 後から archive された `quality-driven` change が既存 TP の Requirement を MODIFIED している
- **THEN** test-plan を対応の入力にせず、delta によって古い対応を「要再確認」とする

#### Scenario: Requirement modified with a new TP
- **WHEN** change B が Requirement を MODIFIED し、同じ change の TP でシナリオ S を割り当てている
- **THEN** 対応表は S を B の TP による「保護（E2E）」とし、A の古い TP を要再確認にしない

#### Scenario: Scenario removed or renamed
- **WHEN** archive 済み change の TP が指すシナリオが、後の REMOVED または RENAMED によって main spec に存在しない
- **THEN** 対応表はその TP を「孤立」として、テストの削除または付け替えの検討対象に表示する
- **AND** Requirement 名を RENAMED した場合も旧名からの対応は引き継がず、新しい名前のシナリオに別の対応が無ければ「未保護」と表示する

### Requirement: Execution results joined to the coverage map
システムは、Playwright の JSON 結果を任意で受け取り、E2E 保護の各行に結果を添えなければならない（SHALL）。照合は change id と TP-ID の両方のトークン完全一致で行い、attempt の分類を既存 E2E レポーターと共有し、coverage の集計では expected-fail を fail、skip を未実行として扱わなければならない（SHALL）。同じ TP の複数結果と、同じシナリオの複数 TP は、fail・未実行・pass の優先順で合成しなければならない（SHALL）。実行結果の集計は「保護（E2E）」の行だけを対象としなければならない（SHALL）。実 attempt のない行は「未実行」としなければならない（SHALL）。失敗または未実行の行を保護済みとして集計してはならない（MUST NOT）。結果を渡さない場合は、結果欄を空にして宣言上の対応だけを表示しなければならない（SHALL）。

#### Scenario: Full regression run is provided
- **WHEN** 全量実行の JSON を渡し、保護（E2E）の TP の一つが fail、一つが実行されていない
- **THEN** 対応表は前者を fail、後者を未実行と表示し、集計の「実行で確認済み」に含めない

#### Scenario: Results include another change with the same TP-ID
- **WHEN** JSON に別 change の同じ TP-ID のテストだけがある
- **THEN** 対応表はその結果を対象の TP に流用せず、未実行と表示する

#### Scenario: Stale or malformed results
- **WHEN** JSON が欠落・不正（suites のネストが 256 階層を超える場合を含む）、または `--max-age` を超えている
- **THEN** コマンドは終了コード 2 で止まり、宣言上の対応表を成功として出力しない

### Requirement: Coverage command interface and exit codes
システムは `testkit-gate.mjs coverage [--results <path>] [--max-age <秒>] [--strict] [--format markdown|json]` を提供しなければならない（SHALL）。既定では分類結果を出力して終了コード 0 で終わらなければならない（SHALL）。`--strict` のとき、未保護、要再確認、孤立、fail、未実行のいずれかがあれば終了コード 1 で終わらなければならない（SHALL）。入力の欠落・破損・鮮度違反および I/O エラーは終了コード 2 としなければならない（SHALL）。予期しない内部例外は終了コード 3 とし、入力エラーと区別してスタックトレースを残さなければならない（SHALL）。既存の `doctor`、`select`、`check` の引数と終了コードを変えてはならない（MUST NOT）。

#### Scenario: Default report
- **WHEN** 未保護のシナリオがあり `--strict` を付けずに実行する
- **THEN** 表と集計を出力し、終了コード 0 で終わる

#### Scenario: Strict mode in CI
- **WHEN** `--strict` を付け、要再確認が 1 件ある
- **THEN** 終了コード 1 で終わり、該当シナリオを出力に含める

#### Scenario: Invalid main or archived spec headings
- **WHEN** main spec または archive の Requirement・Scenario 見出しが不正、または MODIFIED の Requirement 名がそれ以前の archive 履歴で確認できる名前と大小文字だけ異なる
- **THEN** ファイルと理由を示して終了コード 2 で止まり、不完全なシナリオ数や古い保護を成功として出力しない

#### Scenario: Historical names are checked chronologically
- **WHEN** 過去の archive が `login` を MODIFIED・REMOVED し、後の archive が `Login` を ADDED している
- **THEN** 過去の MODIFIED を現在の main spec や将来の archive の名前と比較せず、入力エラーにしない
- **AND** REMOVED の名前と RENAMED の旧名は以後の比較から外し、ADDED・MODIFIED・RENAMED の新名を以後の名前として保持する
- **AND** 進行中 change の名前はシナリオを持たない Requirement も含む現在の main spec と比較し、大小文字違いはその change だけの警告にする。同じ change 内の RENAMED は新名での MODIFIED を許容する

#### Scenario: Overview headings are not declarations
- **WHEN** spec が `# Requirement overview` など説明用の見出しを持つ
- **THEN** 説明用の `#` / `## Requirement overview` と `#` / `## Scenario overview` は許容する。それ以外の Requirement / Scenario（Scenaro の誤記を含む）で始まる見出しは、階層・空白・コロンの有無にかかわらず検査し、全角コロンや括弧を含む不正な宣言も入力エラーにする。先頭の 1〜3 空白は許容する
- **AND** コードフェンス・4 空白またはタブでインデントしたコード・`#requirement-tag` のように名前に英数字・ハイフン・アンダースコアが続く語は宣言として扱わない。単独の `#Requirement` は不正な宣言として診断する

#### Scenario: Main specs are empty
- **WHEN** `openspec/specs` にシナリオが 1 件もない
- **THEN** 0 件であることを明示して出力し、保護率を 100% と表示しない

### Requirement: Legacy test plans are mapped conservatively
システムは旧 `spec-driven-e2e` の archive 済み change から、TP-ID、Requirement、シナリオ名の表として解析できる行だけを対応に使わなければならない（SHALL）。シナリオと結び付けられない TP-ID は「旧形式・対応不明」として別欄に表示し、保護に数えてはならない（MUST NOT）。旧 `quality-driven` の change は test-plan を持たないため、対応の入力にしてはならない（MUST NOT）。

#### Scenario: Missing plan depends on the schema
- **WHEN** archive 済み change に test-plan.md が無い
- **THEN** `quality-driven-e2e` と `spec-driven-e2e` の場合だけ対応不明として報告する
- **AND** `spec-driven` などの delta は引き続き要再確認・孤立の判定に使う
- **AND** change の schema が未指定なら `openspec/config.yaml`（無ければ `config.yml`）の schema を既定値に使い、空・コメントのみの config は schema 未指定として扱う。不正な YAML・mapping 以外の値・文字列でない schema、schema の値または config 全体に付いた独自タグは設定ファイル名と理由を表示して終了コード 2 とする。schema 以外のキーに付いた独自タグは他ツールの設定として無視する。解決できる YAML アンカーは許容し、change と config の両方に指定が無ければ欠落を診断しない
- **AND** 参照先のない YAML エイリアスも解析エラーとして扱う。config と archive の metadata では終了コード 2、進行中 change の metadata では警告とその change の注記除外にする

#### Scenario: Malformed mapping rows are diagnosed
- **WHEN** TP-ID が `TP-NNN` 形式でない、列名・表の見出しが不正、または対象外行のシナリオ名が空である
- **THEN** その行を理由付きで対応不明に表示し、保護に数えない
- **AND** 対象外行のシナリオ列は `Scenario` または `対応シナリオ` を受け付ける
- **AND** 正常な TP 表があっても、対象外表の見出しの誤記（`対象外` または `E2E対象外` で始まる `## 対象外シナリオ` 以外の見出し）・重複・階層や空白の不備、表の代わりの箇条書きを理由付きで診断し、該当する宣言を保護に数えない
- **AND** ヘッダ行だけの表と、表に混在する箇条書きの宣言も理由付きで診断する。混在する正常な表の行は引き続き対応に使う
- **AND** 正常な節の小見出し（`### 正常系` や `### 補足`）の下の表も同じ節の対応として読む。各表はそれぞれのヘッダで読み、列順が異なっても対応を維持する。フェンス内の見出し・表・TP-ID とインデントした説明文は無視し、既存 plan との互換性のためフェンス外のインデントしたパイプ表は読む。`###### 対象外 メモ` のような説明用の小見出しは誤記として扱わない。`#` / `##` の見出し、`E2E観点一覧` を含む見出し、`対象外` で始まる見出しは、階層や空白にかかわらず節の区切りとし、前の節の表として読まない
- **AND** `- 補足: …` や小見出しの下の説明用メモは診断しない。箇条書きの診断は `Scenario:` / `Layer:` などの欄名、または `S: Unit` のようにコロンの後にテスト層（Unit / Integration / Contract / Manual / E2E / 単体 / 結合 / 手動）を書く宣言を対象にする
- **AND** シナリオ列の欠落とシナリオ名の空欄を異なる理由として表示する

#### Scenario: Code fences cannot hide coverage inputs silently
- **WHEN** spec または test-plan にインラインコードの行やコードフェンスがある
- **THEN** バッククォートの info 文字列にバッククォートが含まれる行はフェンスの開始にしない
- **AND** フェンスは同じ記号、開始以上の長さ、info 文字列なしの行でのみ閉じる。異なる記号・短い記号列・info 文字列付きの行では閉じない
- **AND** 閉じていないフェンスはパス付きで診断する。main spec と archive では終了コード 2、進行中 change では警告とその change の注記除外にする

#### Scenario: Unknown schema is not treated as integrated
- **WHEN** change の `.openspec.yaml` または既定の config が未対応の schema 名を持つ
- **THEN** schema を指定した実際のファイル名を警告に表示し、test-plan を保護に数えず、delta は判定に使う。同じ config に由来する警告は一度だけ表示する

#### Scenario: Custom legacy QE schema
- **WHEN** archive の schema が `QE_SCHEMA` で指定された独自の旧 QE schema と一致する
- **THEN** `quality-driven` と同じく test-plan を対応に使わず、delta は判定に使い、未知の schema の警告を出さない

#### Scenario: Legacy plan with a parsable table
- **WHEN** 旧 schema の test-plan に TP-ID とシナリオ名の列を持つ表がある
- **THEN** その行は統合 schema の TP 行と同じ規則で割り当てられる

#### Scenario: Legacy plan with free text only
- **WHEN** 旧 schema の test-plan に TP-ID が本文中にしか現れない
- **THEN** その TP-ID は「旧形式・対応不明」に表示され、どのシナリオの保護にも数えない
- **AND** 本文中は大文字の独立した TP-ID 参照だけを検出し、Fixture のファイル名を TP-ID と誤認しない

### Requirement: Optional regression run in the reusable workflow
再利用可能 workflow は任意入力 `regression-command` と `coverage-strict` を受け付けなければならない（SHALL）。`regression-command` が指定されたとき、change の有無にかかわらず実行し、その結果 JSON を固有の出力先へ保存して coverage コマンドに渡さなければならない（SHALL）。`coverage-strict` が真のときだけ coverage の終了コード 1 を job の失敗にしなければならない（SHALL）。`regression-command` と `coverage-strict` の両方が未指定のときは既存の job の挙動と出力を変えてはならない（MUST NOT）。回帰コマンドの失敗は、coverage の出力を保存した後でも job の失敗として伝えなければならない（SHALL）。

#### Scenario: Implementation-only pull request with regression command
- **WHEN** `openspec/changes` に差分がない PR で `regression-command` が指定されている
- **THEN** 回帰コマンドが実行され、対応表が job の出力として保存される

#### Scenario: Regression command is not configured
- **WHEN** `regression-command` が空で、`coverage-strict` も未指定または false である
- **THEN** workflow は既存と同じ手順と終了コードで完了する

#### Scenario: Coverage strict without a regression command
- **WHEN** `regression-command` が空で、`coverage-strict` が true である
- **THEN** 宣言上の対応表を保存し、未保護・要再確認・孤立を検査する
- **AND** fail・未実行は判定しない旨を表示する

#### Scenario: Regression run fails
- **WHEN** 回帰コマンドが非ゼロで終わる
- **THEN** 対応表を保存したうえで job は失敗する
