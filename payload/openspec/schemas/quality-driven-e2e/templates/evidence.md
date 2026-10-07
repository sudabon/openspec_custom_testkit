# Evidence

未記入のこのテンプレートは成功記録ではありません。値は実行後に置き換えます。

## 追跡

| Risk | Failure Mode | Oracle | Layer | TP-ID | Result | Run-ID |
|------|--------------|--------|-------|-------|--------|--------|
| R1 | F1 | O1 | Integration | | | |

## Execution Records

```json
{
  "format_version": 1,
  "runs": [
    {
      "id": "run-1",
      "command": "",
      "started_at": "",
      "revision": "",
      "exit_code": null,
      "source": "",
      "source_sha256": ""
    }
  ],
  "risk_results": [
    {
      "risk": "R1",
      "failure_modes": ["F1"],
      "oracles": ["O1"],
      "layer": "",
      "tp_ids": [],
      "result": "",
      "run_ids": ["run-1"]
    }
  ],
  "falsification": {
    "performed": false,
    "summary": "",
    "counterexamples": []
  },
  "mutation": {
    "command": "",
    "status": "not-run",
    "score": null,
    "threshold": 70
  },
  "reviews": [],
  "oracle_changes": [],
  "residuals": [],
  "effort": []
}
```

`revision` は検証対象のコミット SHA です。コード・テスト・Oracle・計画をコミットしてから確定します。その後の各 change の evidence.md、test-results/、通常の docs/*.md・README・CHANGELOG の更新は許容します（Oracle や E2E ルートに指定した文書は検証対象です）。検証対象が変わった場合は再実行します。

CI が同じ `command` を実行して同じ `exit_code` を得た run を再現済みとし、全 run を再現できた場合だけ `execution: verified` になります。出力は時刻や所要時間で実行ごとに変わるため、出力ハッシュは照合に使いません（`source` はコミット済みファイルと `source_sha256` の一致を検査します）。再現できない run があると `unverified` ですが、それだけではゲートは失敗しません。

`result` は実行後に `pass` または `fail` だけを書きます。空のままは未実行です。

`reviews` は人間のレビュー記録です（medium 以上で必須）。E2E の fixture を追加・変更した change では、レビュー担当は次も確認します。ゲートはこれらを検査せず、gate の成功は冪等性を保証しません。

- fixture が各テストの前に状態をべき等に作り直すこと（同じ fixture を2回実行しても同じ状態になる）
- テスト間で状態を共有しないこと（実行順を入れ替えても、単独で実行しても結果が変わらない）

最終確認日が `mock_contract_max_age_days` を超えたモックを照合し直さずに受け入れる場合は、`residuals` にモック名を含む Residual を書き、人間が `approved_by` と `approved_at` を記入します。

`effort` は人間の検証作業にかかった時間の任意の記録です。無くても、空のままでもゲートは失敗しません。空の change は集計（`node scripts/testkit-gate.mjs effort`）で 0 分ではなく「未記録」として数えます。記録する場合は、作業した人間が活動ごとに1要素を書きます。

```text
"effort": [
  { "activity": "qa-review", "minutes": 30, "recorded_by": "qa-member" },
  { "activity": "manual-test", "minutes": 45, "recorded_by": "qa-member" }
]
```

| activity | 作業 |
|----------|------|
| `approval` | quality.md の確認と承認 |
| `seal` | Oracle の確認と seal |
| `qa-review` | QA レビュー（`openspec/roles/qa-reviewer.md`） |
| `falsification-review` | 反証結果と Residual の確認 |
| `code-review` | Human Code Review |
| `manual-test` | qa-handoff.md の手動確認範囲と探索チャーターの実施 |
| `other` | 上のどれにも当たらない人間の作業 |

`minutes` は 0 以上の数値、`recorded_by` は記入者です。未知の `activity`、負数や数値でない `minutes`、`recorded_by` の欠落は構造エラーになります。Agent は所要分を推測で埋めない。人間が記入しなかった時間は空のままにします。

## Oracle Changes

seal 後に Oracle を変えたときだけ、変更理由、再承認、再seal を本文と JSON の両方に残します。変更がなければ「なし」と書きます。

- なし

## 欠落例

次は不合格です。Risk ID だけの行、source の hash 不一致、検証対象の内容と一致しない revision、反証の未実施、high で Mutation 未実行、未承認の Residual。
