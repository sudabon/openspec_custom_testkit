# 検証索引

capability 6、requirement 31、scenario 66。各 scenario は一度だけ載せる。

| Capability | Requirement | Scenario | 検証 |
|---|---|---|---|
| change-gate-selection | Common schema-aware gate selection | Mixed schema pull request | test/gates.test.mjs |
| change-gate-selection | Common schema-aware gate selection | Unrelated schema | test/gates.test.mjs |
| change-gate-selection | Fail closed on ambiguous metadata | Broken or removed schema declaration | test/gates.test.mjs |
| change-gate-selection | Archive and deletion detection | Archive rename | test/gates.test.mjs |
| change-gate-selection | Archive and deletion detection | Deletion without archive | test/gates.test.mjs |
| change-gate-selection | Selection inputs remain compatible | Legacy schema override | test/gates.test.mjs |
| change-gate-selection | No change diff is not regression coverage | Implementation-only pull request | test/gates.test.mjs |
| change-gate-selection | No change diff is not regression coverage | Invalid comparison reference | test/gates.test.mjs |
| ci-distribution-contract | Explicit CI execution contract | Monorepo working directory | test/contract.test.mjs と examples/ci/README.md |
| ci-distribution-contract | Explicit CI execution contract | Alternative package manager | examples/ci/README.md |
| ci-distribution-contract | Explicit CI execution contract | Unsupported setup | test/contract.test.mjs |
| ci-distribution-contract | Preserve CI failures and trusted command inputs | Reporter output is saved after failure | test/contract.test.mjs |
| ci-distribution-contract | Preserve CI failures and trusted command inputs | Only non-applicable changes | test/smoke.mjs |
| ci-distribution-contract | Portable and complete distribution | Install from packed artifact | test/distribution.test.mjs |
| ci-distribution-contract | Portable and complete distribution | OpenSpec command regeneration | test/distribution.test.mjs |
| ci-distribution-contract | Portable and complete distribution | Ignored hidden payload | test/install.test.mjs と test/distribution.test.mjs |
| ci-distribution-contract | Document compatibility and provenance | Old workflow migration | examples/ci/README.md |
| ci-distribution-contract | Verification evidence distinguishes unexecuted work | Local verification only | docs/compatibility.md |
| e2e-plan-reporting | Explicit applicability and complete scenario mapping | Missing or inconsistent applicability | test/gates.test.mjs |
| e2e-plan-reporting | Explicit applicability and complete scenario mapping | Justified non-applicability | test/gates.test.mjs |
| e2e-plan-reporting | Explicit applicability and complete scenario mapping | Empty plan | test/gates.test.mjs |
| e2e-plan-reporting | Scoped test identifiers | Same TP identifier in another change | test/gates.test.mjs |
| e2e-plan-reporting | Scoped test identifiers | Tags exist but test did not run | test/gates.test.mjs |
| e2e-plan-reporting | Execution result semantics | Skipped or empty execution | test/gates.test.mjs |
| e2e-plan-reporting | Execution result semantics | Flaky retry succeeds | test/gates.test.mjs |
| e2e-plan-reporting | Execution result semantics | Test failure and missing coverage coexist | test/gates.test.mjs |
| e2e-plan-reporting | Reporter interface and freshness | Stale missing or malformed report | test/gates.test.mjs |
| e2e-plan-reporting | Reporter interface and freshness | A later run writes no report | test/contract.test.mjs |
| e2e-plan-reporting | Reporter interface and freshness | Legacy reporter invocation | test/gates.test.mjs |
| integrated-quality-workflow | Planning artifact dependency graph | Plan progresses through the declared dependencies | test/distribution.test.mjs |
| integrated-quality-workflow | Planning artifact dependency graph | Apply receives all planning inputs | test/distribution.test.mjs |
| integrated-quality-workflow | Artifact sources of truth | Trace from scenario to evidence | test/smoke.mjs |
| integrated-quality-workflow | Artifact sources of truth | Unit oracle has no E2E identifier | test/gates.test.mjs |
| integrated-quality-workflow | Human gates for every integrated risk level | Low risk still requires seal and falsification | test/gates.test.mjs |
| integrated-quality-workflow | Human gates for every integrated risk level | Agent reaches a human gate | schema.yaml の apply 指示を文書レビュー |
| integrated-quality-workflow | Human gates for every integrated risk level | Synthetic approval remains a fixture | test/smoke.mjs と test/smoke-app/README.md |
| integrated-quality-workflow | Independent verification context | No isolated agent facility is available | docs/workflow.md |
| integrated-quality-workflow | Independent verification context | Oracle is itself an E2E test | schema.yaml の tasks 指示を文書レビュー |
| integrated-quality-workflow | Spec skipping without invented requirements | Documentation-only plan | test/distribution.test.mjs |
| integrated-quality-workflow | Task sequence preserves oracle independence | Task completion before seal | test/gates.test.mjs |
| quality-evidence-gates | Approval and risk validation | Missing quality or approval | test/evidence.test.mjs |
| quality-evidence-gates | Approval and risk validation | Risk understatement | test/evidence.test.mjs |
| quality-evidence-gates | Sealed oracle integrity | Low implementation precedes seal | test/gates.test.mjs |
| quality-evidence-gates | Sealed oracle integrity | Oracle set changes after seal | test/evidence.test.mjs |
| quality-evidence-gates | Sealed oracle integrity | Empty oracle set | test/gates.test.mjs |
| quality-evidence-gates | Falsification and mutation evidence | Low falsification is absent | test/evidence.test.mjs |
| quality-evidence-gates | Falsification and mutation evidence | High mutation is absent or insufficient | test/evidence.test.mjs |
| quality-evidence-gates | Falsification and mutation evidence | Counterexample is retained | test/evidence.test.mjs |
| quality-evidence-gates | Structured execution evidence | Identifiers without results | test/evidence.test.mjs |
| quality-evidence-gates | Structured execution evidence | E2E is not applicable | test/gates.test.mjs |
| quality-evidence-gates | Structured execution evidence | Oracle was resealed | test/contract.test.mjs |
| quality-evidence-gates | Archive finalization checks | Archive with incomplete evidence | test/gates.test.mjs は archive 選択まで。証跡欠落の最終検査は部分的 |
| safe-kit-installation | Idempotent installation command | Install before and after OpenSpec init | test/install.test.mjs |
| safe-kit-installation | Idempotent installation command | Repeat installation and update | test/install.test.mjs |
| safe-kit-installation | Idempotent installation command | Dry run on a missing target | test/install.test.mjs |
| safe-kit-installation | Preserve user configuration and edits | Force update with local edits | test/install.test.mjs |
| safe-kit-installation | Preserve user configuration and edits | Legacy context marker | test/install.test.mjs |
| safe-kit-installation | Preserve user configuration and edits | Unsupported config representation | test/install.test.mjs |
| safe-kit-installation | Schema and change compatibility | Custom schema and in-flight change | test/install.test.mjs |
| safe-kit-installation | Schema and change compatibility | Legacy change continues | test/distribution.test.mjs |
| safe-kit-installation | Safe legacy migration | Known and edited legacy files | test/install.test.mjs |
| safe-kit-installation | Safe legacy migration | Critical gate remains old | test/install.test.mjs |
| safe-kit-installation | Stable and safe E2E placement | Monorepo update | test/install.test.mjs |
| safe-kit-installation | Stable and safe E2E placement | Multiple Playwright configs | test/install.test.mjs |
| safe-kit-installation | Stable and safe E2E placement | Path escapes target | test/install.test.mjs |
| safe-kit-installation | Repo-local support boundary | Store-backed project | test/install.test.mjs |

## V01–V20

| ID | 実施 | 残り |
|---|---|---|
| V01 | test/distribution.test.mjs の実 CLI | hosted Actions 上の schema 検証は未実施 |
| V02 | test/gates.test.mjs と test/contract.test.mjs、roles 文書 | 実人間の承認・seal は行っていない |
| V03 | test/gates.test.mjs と test/contract.test.mjs | |
| V04 | test/install.test.mjs | |
| V05 | test/install.test.mjs | |
| V06 | test/install.test.mjs と test/contract.test.mjs の doctor | |
| V07 | test/install.test.mjs と test/contract.test.mjs | |
| V08 | test/install.test.mjs と test/contract.test.mjs | global defaultStore の実 CLI 応答は store 宣言 fixture で拒否を確認 |
| V09 | test/gates.test.mjs | |
| V10 | test/gates.test.mjs と test/contract.test.mjs | |
| V11 | test/evidence.test.mjs と test/contract.test.mjs | |
| V12 | test/contract.test.mjs | |
| V13 | test/contract.test.mjs | |
| V14 | test/gates.test.mjs と test/smoke.mjs | |
| V15 | test/gates.test.mjs と test/contract.test.mjs | |
| V16 | test/gates.test.mjs と test/contract.test.mjs | |
| V17 | test/contract.test.mjs と examples/ci/README.md | workflow を hosted Actions では実行していない |
| V18 | test/distribution.test.mjs | |
| V19 | docs と macOS の Node 20/22 | Linux は未検証 |
| V20 | test/smoke.mjs | |

Linux、hosted GitHub Actions、公開レジストリからの npx 導入は未検証。ローカルの macOS と pack 結果で代替しない。承認・seal の合格記録は作っていない。
