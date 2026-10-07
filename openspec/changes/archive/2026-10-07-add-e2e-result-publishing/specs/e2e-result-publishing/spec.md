# Spec Delta

## Purpose

QA や承認者が、手元で再現しなくても E2E の実行結果を PR から確認できるようにする。TP ごとの結果と、失敗の根拠となる添付を人向けの形で公開する。公開処理は品質ゲートの判定を変えない。

## ADDED Requirements

### Requirement: Human-readable E2E summary

レポータは、人向けの summary 形式を MUST 提供する。summary には、対象 change に属するテストごとに、TP-ID、テスト名、project、結果、フレークの有無、添付の参照を載せる。結果の分類とカバレッジ欠落の判定は、既定形式と同じものを使う MUST。summary 形式を選んでも終了コード 0/1/2/3 の意味は変えない MUST。形式を指定しない呼び出しの標準出力は変えない MUST。

#### Scenario: Summary for a mixed result

- **WHEN** pass、fail、flaky、skip のテストを含む結果に summary 形式を指定する
- **THEN** 各テストが TP-ID・project・結果・フレークの有無付きで一行ずつ出る
- **AND** 終了コードは同じ入力の既定形式と一致する

#### Scenario: Missing coverage in summary

- **WHEN** 計画した TP の一部に実行されたテストがない
- **THEN** summary は欠落した TP-ID を明示し、終了コードは 1 になる

#### Scenario: Default format is unchanged

- **WHEN** 形式を指定せずに既存の引数でレポータを呼ぶ
- **THEN** 標準出力と終了コードは本 change の前と同じになる

### Requirement: Attachment references for failed and flaky tests

summary は、Playwright JSON の attempt に記録された trace / screenshot / video の添付を MUST 参照する。参照は artifact 内の相対パスで示し、runner の絶対パスは出さない MUST。添付が存在しない、または artifact の対象外にあるときは、「添付なし」と区別して示す MUST。添付ファイルの中身は summary に埋め込まない MUST。

#### Scenario: Failed test with trace

- **WHEN** 失敗したテストの最後の attempt に trace と screenshot の添付がある
- **THEN** summary のその行に、両方の artifact 内相対パスが出る

#### Scenario: Attachment outside the published directory

- **WHEN** 添付のパスが artifact に含める directory の外にある
- **THEN** summary はその添付を「公開対象外」と示し、絶対パスを出さない

### Requirement: Publish results to the pull request context

reusable workflow は、E2E を実行したときに各 change の summary を step summary に MUST 書き出す。Playwright HTML レポートと今回の実行の結果 directory を artifact として MUST 保存し、step summary にワークフロー実行と artifact への参照を出す。前回の実行の結果や他の実行の結果 directory を、今回の結果として公開してはならない MUST NOT。PR コメントへの投稿は任意入力でだけ有効にし、既定は無効とする MUST。

#### Scenario: E2E runs in a pull request

- **WHEN** E2E required の change を含む PR で gate が E2E を実行する
- **THEN** step summary に change ごとの summary と artifact への参照が出る
- **AND** artifact には今回の実行の HTML レポートと結果 directory だけが入る

#### Scenario: No E2E command is configured

- **WHEN** 対象 change がすべて E2E 対象外で、e2e-command が空である
- **THEN** step summary には E2E を実行しなかった理由が出て、空の結果表は出ない

#### Scenario: PR comment is not enabled

- **WHEN** PR コメントの入力を指定しない
- **THEN** workflow は PR コメントを投稿せず、追加の書き込み権限を必要としない

### Requirement: Publishing does not alter the gate verdict

公開処理（step summary、artifact、PR コメント）は、ゲートやテストが失敗したときも MUST 実行する。ゲートやテストの失敗は、公開処理が成功しても最終 job に MUST 伝わる。公開処理の失敗は警告として表示し、ゲートの合否を変えてはならない MUST NOT。ゲートの合否は、公開処理の有無に関係なく同じ入力から同じになる MUST。

#### Scenario: Gate fails and publishing succeeds

- **WHEN** E2E が失敗し、summary と artifact の保存は成功する
- **THEN** 最終 job は失敗する

#### Scenario: PR comment lacks permission

- **WHEN** PR コメントを有効にしたが、fork PR などで書き込み権限がない
- **THEN** workflow は権限不足を警告し、ゲートの合否は投稿を無効にしたときと同じになる

#### Scenario: Summary cannot be written

- **WHEN** step summary の書き出しに失敗する
- **THEN** 失敗は警告として出て、ゲートの終了コードは変わらない

### Requirement: Sensitive attachments and retention

公開する artifact の保持期間は、入力で指定できる MUST。指定しないときは GitHub の既定に従う。添付（screenshot、video、trace）に画面上の個人情報や認証情報が含まれうることを、導入文書で MUST 注意する。kit は添付の中身を自動で検査・マスキングしたと MUST NOT 主張しない。

#### Scenario: Retention is specified

- **WHEN** 呼び出し側が保持期間に 7 日を指定する
- **THEN** 公開する artifact の保持期間は 7 日になる

#### Scenario: Retention input is invalid

- **WHEN** 保持期間に正の整数以外を指定する
- **THEN** workflow は公開の前に入力エラーとして失敗し、ゲートを成功と報告しない
