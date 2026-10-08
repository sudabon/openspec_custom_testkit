# Spec Delta

## MODIFIED Requirements

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
