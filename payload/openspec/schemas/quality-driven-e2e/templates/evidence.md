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

`revision` は検証対象のコミット SHA です。取得元を含む検証対象をコミットしてから確定し、その後はこの evidence.md だけをコミットできます。検証対象が変わった場合は再実行します。

`result` は実行後に `pass` または `fail` だけを書きます。空のままは未実行です。

## Oracle Changes

<!-- seal 後に Oracle を変えたときだけ、変更理由、再承認、再seal を本文と JSON の両方に残します。変更がなければ「なし」と書きます。 -->

- なし

## 欠落例

次は不合格です。Risk ID だけの行、source の hash 不一致、検証対象の内容と一致しない revision、反証の未実施、high で Mutation 未実行、未承認の Residual。
