---
e2e: required
reason: ""
alternative_verification: []
---

# Test Plan

## E2E観点一覧

| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
|-------|-------------|----------|------|--------|---------|--------|----------|
| TP-001 | Add item | Add one item | R1 | O1 | seed | 確認 | 成功 |
| TP-002 | Checkout button | Empty cart | R1 | O1 | seed | 確認 | 成功 |
| TP-003 | Coupon | Apply coupon | R1 | O1 | seed | 確認 | 成功 |
| TP-004 | Add item | Nonexistent scenario | R1 | O1 | seed | 確認 | 成功 |

## 対象外シナリオ

| Scenario | Reason | Oracle | Layer | Method |
|----------|--------|--------|-------|--------|
| Add item when out of stock | E2E 不要 | O2 | Unit | stock service unit test |
