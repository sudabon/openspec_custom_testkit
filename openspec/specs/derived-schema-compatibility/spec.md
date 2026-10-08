# derived-schema-compatibility Specification

## Purpose
統合 schema `quality-driven-e2e` に artifact やタスクを足した派生 schema を、アドオン kit が配布できるようにする。派生 schema の change は、testkit の人間ゲート・Oracle seal・独立反証・E2E 計画ゲートを一つも失わずに統合 change として検査される。

## Requirements

### Requirement: Derived schema compatibility declaration

派生 schema は、project-local の schema ディレクトリ `openspec/schemas/<name>/` に `testkit-compat.json` を置いて、統合 schema との互換を宣言しなければならない（MUST）。宣言は JSON object で、`extends` に `quality-driven-e2e`、`compatVersion` に整数 `1` を持たなければならない（MUST）。宣言が有効になるのは、次の条件をすべて満たすときに限る。

- 同じディレクトリの `schema.yaml` の `name` がディレクトリ名と一致する
- 名前が `quality-driven-e2e`、`quality-driven`、`spec-driven-e2e`、`spec-driven` のいずれでもない
- 統合 schema の artifact `proposal`、`specs`、`quality`、`design`、`test-plan`、`tasks` を、統合 schema と同じ `generates` で持つ
- 各 artifact の `requires` が統合 schema の `requires` をすべて含む
- `apply.requires` が `tasks` を含み、`apply.tracks` が `tasks.md` である
- templates に `evidence.md` と `qa-handoff.md` がある

派生 schema は、統合 schema に無い artifact と依存を追加してよい（MAY）。testkit は project-local 以外（ユーザー領域やパッケージ同梱）の schema の宣言を読んではならない（MUST NOT）。

#### Scenario: Valid declaration

- **WHEN** `openspec/schemas/quality-driven-e2e-mockup/` に `name: quality-driven-e2e-mockup` の schema.yaml がある。schema.yaml は統合 schema の6 artifact を同じ出力と依存で持ち、`mockup-plan` artifact を追加している。同じディレクトリに `{"extends": "quality-driven-e2e", "compatVersion": 1}` の `testkit-compat.json` がある
- **THEN** testkit は `quality-driven-e2e-mockup` を統合系統の派生 schema として認識する

#### Scenario: Derived schema drops a required artifact

- **WHEN** 宣言のある派生 schema に `test-plan` artifact が無いか、`quality` の `requires` から `specs` が外れている
- **THEN** 宣言は無効とされ、欠けている artifact または依存の名前が診断に表示される

#### Scenario: Declaration reuses a reserved name

- **WHEN** `openspec/schemas/spec-driven/testkit-compat.json` が統合互換を宣言している
- **THEN** 宣言は無効とされ、予約名であることが診断に表示される

#### Scenario: Unsupported compatibility version

- **WHEN** 宣言の `compatVersion` が `2`、または `extends` が `quality-driven` である
- **THEN** 宣言は無効とされ、対応している値が診断に表示される

### Requirement: Derived changes inherit every integrated gate

有効な宣言を持つ派生 schema の change は、select・check（plan / final）・lint・seal・evidence・QA handoff・coverage・effort・reporter のすべてで、`quality-driven-e2e` の change と同じ検査を受けなければならない（MUST）。既存 spec で「統合 schema」と書かれた要求は、宣言済みの派生 schema にも同じく適用される。Oracle の digest は統合 schema と同じ `manifest-sha256:` 形式で計算しなければならない（MUST）。`QE_SCHEMA`・`QE_SEAL_REQUIRED_LEVELS` などの環境変数で、派生 schema の change を旧 schema 扱いにしたり、検査を外したりできてはならない（MUST NOT）。testkit は、派生 schema が追加した artifact やタスクグループを検査せず、その存在を理由に失敗させてもならない（MUST NOT）。

#### Scenario: Unapproved derived change starts implementation

- **WHEN** 派生 schema の change の quality.md で `approved_by` が空のまま、tasks の 2.1 が完了になっている
- **THEN** 計画ゲートは `quality-driven-e2e` の change と同じく、承認の欠落として失敗する

#### Scenario: Seal uses the integrated digest

- **WHEN** 人間が派生 schema の change に `scripts/qe-gate.sh seal <change>` を実行する
- **THEN** `oracle_digest` は `manifest-sha256:` 形式で記録され、全 Risk Level で seal が要求される

#### Scenario: Extra artifact is ignored by testkit

- **WHEN** 派生 schema の change に、統合 schema に無い `mockup-plan.md` と `## 7. Mockup` のタスクグループがある
- **THEN** testkit のゲートはそれらを検査せず、統合 schema の検査結果だけで判定する

#### Scenario: Environment variable cannot downgrade

- **WHEN** `QE_SCHEMA=quality-driven-e2e-mockup` を指定して、派生 schema の change を検査する
- **THEN** その change は旧 QE 扱いにならず、統合 change として検査される

### Requirement: Fail closed on broken or removed declarations

ある change が使う schema について、次のいずれかに当てはまるとき、ゲートはその change を対象外にせず、診断を出して非ゼロで終了しなければならない（MUST）。

- 宣言が JSON として読めない
- 宣言が上記の有効条件を満たさない
- 比較元 ref では有効だった宣言が、HEAD で削除または無効化されている

比較元 ref を付けた選択では、比較元で有効だった宣言が HEAD で削除または無効化されたとき、その schema を `.openspec.yaml` で宣言している HEAD の active change を、change 自体の差分が無くても選択に加えなければならない（MUST）。加えた change は、統合 change として検査されなければならない（MUST）。その schema を宣言する active change が無ければ、宣言の削除を失敗にしてはならない（MUST NOT）。宣言を無効にする原因は、宣言ファイルの削除、内容の変更、派生 schema の schema.yaml やテンプレートの変更、統合 schema の変更のいずれでもよい。どの原因でも同じく扱わなければならない（MUST）。

宣言ファイルの無い独自 schema の change は、これまでどおり理由付きの対象外として扱わなければならない（MUST）。

#### Scenario: Declaration removed in the pull request

- **WHEN** 比較元で `quality-driven-e2e-mockup` に有効な宣言があり、PR でその `testkit-compat.json` が削除され、その schema の change が差分に含まれる
- **THEN** ゲートはその change を統合 change として検査し続け、宣言の消失を報告して非ゼロで終了する

#### Scenario: Declaration removed without touching the change

- **WHEN** 比較元で有効だった `quality-driven-e2e-mockup` の `testkit-compat.json` だけを PR で削除し、HEAD の active change `demo` がその schema を宣言しているが、`openspec/changes/demo/` に差分が無い
- **THEN** ゲートは `demo` を選択に加え、統合 change として検査し、宣言の消失を報告して非ゼロで終了する

#### Scenario: Declaration invalidated through the schema file

- **WHEN** PR で派生 schema の schema.yaml から `test-plan` artifact が削除され、宣言が無効になり、HEAD の active change がその schema を宣言している
- **THEN** ゲートはその change を選択に加え、宣言の無効化を理由に非ゼロで終了する

#### Scenario: Unused declaration is removed

- **WHEN** PR で `quality-driven-e2e-mockup` の宣言が削除され、HEAD の active change にその schema を宣言するものが無い
- **THEN** ゲートは宣言の削除を理由に失敗しない

#### Scenario: Malformed declaration

- **WHEN** `testkit-compat.json` が JSON として不正である
- **THEN** ゲートは宣言のパスと解析エラーを表示して失敗し、その schema の change を対象外にしない

#### Scenario: Custom schema without declaration

- **WHEN** 宣言ファイルの無い独自 schema `team-custom` の change だけが差分にある
- **THEN** ゲートはこれまでどおり無関係な schema として対象外の理由を表示する

### Requirement: Selection output shows declared and effective schema

選択結果（`testkit-gate.mjs select --json` とゲートの表示）は、派生 schema の change について、`.openspec.yaml` に書かれた schema 名と、判定に使った系統 `quality-driven-e2e` の両方を示さなければならない（MUST）。統合 schema と旧 schema の change の既存の出力項目は、変えてはならない（MUST NOT）。

#### Scenario: Select JSON for a derived change

- **WHEN** 派生 schema の change を `select --json` で選ぶ
- **THEN** その要素は宣言上の schema 名 `quality-driven-e2e-mockup` と、判定上の schema `quality-driven-e2e` を持つ

### Requirement: Doctor and installer handle derived schemas

`doctor` は、認識した派生 schema の名前を一覧にして注記に出さなければならない（MUST）。無効な宣言があれば、パスと理由を示して失敗しなければならない（MUST）。install と update は、`openspec/schemas/` 配下の、kit が配布していない schema ディレクトリを作成・変更・削除してはならない（MUST NOT）。`openspec/config.yaml` の既定 schema が有効な宣言を持つ派生 schema であれば、install はそれを書き換えてはならず（MUST NOT）、統合 schema への移行を促す警告も出してはならない（MUST NOT）。

#### Scenario: Doctor lists a derived schema

- **WHEN** 有効な宣言を持つ `quality-driven-e2e-mockup` がある repo で `testkit-gate.mjs doctor` を実行する
- **THEN** 注記に `quality-driven-e2e-mockup` が統合系統の派生 schema として表示され、doctor の成否は他の検査だけで決まる

#### Scenario: Update keeps the derived schema

- **WHEN** 派生 schema がある repo で testkit の update を実行する
- **THEN** 派生 schema のディレクトリの内容は変わらず、既定 schema が派生 schema のときも config.yaml の `schema:` は変わらない

### Requirement: Public schema family module

kit は、schema 名から統合系統かどうかと宣言の診断を返す公開モジュールを `scripts/lib/schema-family.mjs` として配布しなければならない（MUST）。このモジュールを配布の必須 module に含め、旧版のままの導入を doctor が incomplete として報告するようにしなければならない（MUST）。アドオンはこのモジュールの判定結果を使えるが、判定を弱めるための設定口を持ってはならない（MUST NOT）。

#### Scenario: Older install without the module

- **WHEN** `scripts/lib/schema-family.mjs` を記録していない旧 stamp の repo で doctor を実行する
- **THEN** doctor は必須 module の欠落として失敗し、install の再実行を案内する
