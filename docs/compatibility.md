# 互換性と検証環境

## 対応の宣言

- Node.js 20 以上。検証に使う版は 20 と 22。
- OpenSpec CLI 1.13.1。
- 旧 `quality-driven` と `spec-driven-e2e` の成果物形式は維持する。統合の承認、seal、反証、JSON evidence を旧 change へ遡及しない。

## 終了コード

| 入口 | 0 | 1 | 2 | 3 |
|------|---|---|---|---|
| install / update | 処理完了（未移行があり得る） | 実行失敗 | 引数不正 | - |
| qe-gate check | 失敗なし | 検査失敗 | 引数または比較元の不正 | - |
| e2e-report | 成功 | coverage 不足 | 入力または鮮度 | テスト失敗 |

失敗 3 は coverage 不足 1 より優先する。`--max-age` を付けない呼出しは、時刻が無くても鮮度では拒否せず、時刻を表示する。

## この環境で実行した結果

ホストは macOS（Darwin）。Node 20 と 22 の結果は `docs/verification-log.md` にコマンド出力の要約を残す。Linux の行は、この作業環境で実行できない限り未検証のままにする。GitHub 上の `npx` と hosted Actions の成功は、ローカルの pack と workflow ファイル検査では代替しない。

## 旧 reporter の誤合格

`test/baseline-notes.md` に記録した。期待値は緩和していない。

## 統合版の digest 正規化

`manifest-sha256:` は Oracle の全ファイルをパスでソートし、重複を除外して計算する。修正前の統合版で、複数の `oracle_paths` を逆順や重複ありで seal した場合は digest が変わるため、人間確認のうえ一度再 seal し、evidence の履歴に記録する。

旧 `sha256:` も、重なった `oracle_paths` のファイルは一度だけ数えて seal する。重なりがなければ値は旧 `qe-gate.sh` と同じである。旧 `qe-gate.sh` は重なったファイルを重複して数えていたため、検査ではその形式の digest も受理し、既存の seal を無効にしない。
