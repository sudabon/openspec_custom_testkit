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
  "residuals": []
}
```

`revision` は検証対象のコミット SHA です。コード・テスト・Oracle・計画をコミットしてから確定します。その後の各 change の evidence.md、test-results/、通常の docs/*.md・README・CHANGELOG の更新は許容します（Oracle や E2E ルートに指定した文書は検証対象です）。検証対象が変わった場合は再実行します。

CI と記録済み run のコマンド・終了コード・出力ハッシュが一致した場合だけ `execution: verified` になります。別実行の時刻や所要時間で出力が変わる場合は `unverified` であり、それだけではゲートは失敗しません。

`result` は実行後に `pass` または `fail` だけを書きます。空のままは未実行です。

## Oracle Changes

seal 後に Oracle を変えたときだけ、変更理由、再承認、再seal を本文と JSON の両方に残します。変更がなければ「なし」と書きます。

- なし

## 欠落例

次は不合格です。Risk ID だけの行、source の hash 不一致、検証対象の内容と一致しない revision、反証の未実施、high で Mutation 未実行、未承認の Residual。
