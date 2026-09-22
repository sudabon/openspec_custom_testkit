# Smoke fixture

このディレクトリの承認文字列 `FIXTURE-DUMMY-APPROVAL` は人間の承認ではありません。隔離した自動テストの中だけで使い、実プロジェクトの quality.md に写してはいけません。

Oracle は `COUNTER_IMPL=red` のとき、加算しない実装に対して失敗します。通常の `counter.mjs` は 1 に 1 を足して 2 になり、0 の差分を拒否します。Playwright は localhost の表示が 0 から 1 に変わることだけを見ます。
