---
e2e: required
reason: ""
alternative_verification: []
---

# Test Plan

## E2E観点一覧

| TP-ID | Requirement | Scenario | Risk | Oracle | Fixture | Intent | Expected |
|-------|-------------|----------|------|--------|---------|--------|----------|
| TP-001 | Show total | Show tax | R1 | O1 | seed | 確認 | 成功 |

## 対象外シナリオ

| Scenario | Reason | Oracle | Layer | Method |
|----------|--------|--------|-------|--------|
| Show subtotal | E2E 不要 | O1 | Unit | total unit test |
