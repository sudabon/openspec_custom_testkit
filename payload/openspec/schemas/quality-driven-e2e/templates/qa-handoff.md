# QA Handoff

QA エンジニアへの引き継ぎです。QA は「自動化済み範囲」を確認し直さず、「手動確認範囲」と「探索チャーター」だけを確認します。

quality.md の Test Layer Mapping に `Manual` の行があるか、quality.md または evidence.md に Residual があるときに作ります。どれも無い change では不要です。

`<!-- example -->` の付いた行は記入例です。すべて実際の値の行に置き換えてください。印が残っている行と、必須の欄が空の行は未記入として final gate が失敗します。

## 自動化済み範囲

evidence.md の `risk_results` のうち `result` が `pass` の Risk だけを、すべて載せます。`pass` でない Risk は載せません。CI の実行確認が `execution: unverified` のときは、表の下にその旨を書きます。TP-ID は E2E 層のときだけ書きます。

| Risk | Failure Mode | Oracle | Layer | TP-ID | Run-ID |
|------|--------------|--------|-------|-------|--------|
| R1 <!-- example --> | F1 | O1 | Unit | | run-1 |

## 手動確認範囲

quality.md で `Manual` 層にした Failure Mode のすべてと、quality.md の Residual Risk（`RR1` など）と evidence.md の `residuals`（`id`）のすべてを、ID 付きで載せます。種別は `Manual` か `Residual` です。

| ID | 種別 | 確認観点 | 理由 |
|----|------|----------|------|
| F2 <!-- example --> | Manual | 印刷したときのレイアウト | 実機プリンタが必要で自動化しない |
| RR1 <!-- example --> | Residual | 時刻が日付をまたぐ場合の表示 | Green では保証しない |

## 探索チャーター

各行に目的・対象・時間の目安を書きます。

| Charter-ID | 目的 | 対象 | 時間の目安 |
|------------|------|------|------------|
| C1 <!-- example --> | 印刷崩れを探す | 請求書の印刷画面 | 30分 |

## QA 実施結果

この欄は人間（QA の実施者）だけが記入します。Agent は記入しない。空欄のまま残してください。

PR の final 検査では空でも失敗せず警告になります。archive の前に、実施者、`YYYY-MM-DD` 形式の実施日、`pass` または `fail` の判定を記入します。判定が `fail` のままでは archive できません。所見を修正するか、Residual として人間が承認し直してください。kit は記入者の本人確認をしません。誰が記入したかの保証は CODEOWNERS とブランチ保護に依存します。

| 実施者 | 実施日 | 判定 | 所見 |
|--------|--------|------|------|
|        |        |      |      |
