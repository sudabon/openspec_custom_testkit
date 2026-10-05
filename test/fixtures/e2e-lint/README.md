# E2E lint fixtures

`test/e2e-lint.test.mjs` が読む隔離 fixture。Playwright では実行しない（`npm test` は `test/*.test.mjs` だけを実行する）。
change id は `demo` に揃えている。

| Spec Scenario | fixture |
|---------------|---------|
| Prohibited pattern in a test | `rules/fixed-wait.bad.spec.ts`, `rules/locator.bad.spec.ts`, `rules/template.bad.spec.ts` |
| Pattern appears only in a comment or string | `rules/comments-strings.good.spec.ts`, `rules/component.good.spec.tsx` |
| Excluded test still carries a TP tag | `rules/excluded.bad.spec.ts`, `rules/aliases.bad.spec.ts` |
| Missing change / TP tags | `rules/tags.bad.spec.ts` |
| Locator values, TS non-null division, control regex, TSX generics | `rules/review.good.spec.tsx` |
| Test without any assertion | `rules/assertions.bad.spec.ts`（操作だけ）, `root/checkout.spec.ts`（操作だけの Page Object） |
| Existence-only assertions | `rules/assertions.bad.spec.ts`, `root/checkout.spec.ts`（存在確認だけの helper） |
| Assertion through a page object helper | `root/checkout.spec.ts`, `root/pages/checkout.ts`, `root/helpers/assert.ts` |
| Untouched legacy test | `e2e-lint.test.mjs` の scope harness（一時 git repo） |
| Changed file outside the change tag | 同上 |
| Attempt to disable via environment | `e2e-lint.test.mjs` の policy テスト |
| Agent adds its own suppression | `suppress/banner.spec.ts`（RES-2） |
| Approved exception | `suppress/banner.spec.ts`（RES-1） |
| Suppression without residual | `suppress/banner.spec.ts`（ID なし、RES-404） |
| Unparseable source in scope | `rules/unterminated.bad.spec.ts` |
| Whole-root report | `e2e-lint.test.mjs` の `testkit-gate.mjs lint` テスト |
| Not-applicable change | `e2e-lint.test.mjs` の gate テスト |

正常例（`*.good.*`）は指摘 0 件、違反例（`*.bad.*`）は規則 ID・行・テスト名つきで指摘されることを検査する。
`rules/structure.good.spec.ts` は入れ子の describe、`test.describe.configure`、オプション引数の有無、describe とタイトルのタグを扱う。
