# 旧 kit から引き継がない誤合格

1. 旧 reporter は、change タグに関係なく JSON 内の TP を数え、skip も実行済みにしていた。統合 reporter は change id と TP-ID のトークン境界が一致し、attempt がある expected または flaky だけを coverage にする。fixture `test/fixtures/legacy-sample-results.json` はタグ `add-checkout` のままにし、change id `add-checkout` で失敗 3、`demo-change` では coverage 不足になる。
2. 旧 `check-test-plan.sh` は `@id` の部分文字列で、接頭辞や正規表現メタ文字を一致させていた。境界は英数字、`.`、`_`、`-` を識別子の一部として扱う。
3. 旧 QE の空ディレクトリ digest は成功し得た。統合 digest と旧 digest adapter は空集合を成功にしない。空でない旧 `sha256:` digest の形は維持する。

旧 selftest が spec-driven への導入で schema を `quality-driven` にすることを期待していた場合、この CLI は `quality-driven-e2e` に切り替える。旧 schema の挙動は、config または change の schema を明示したときに確認する。
