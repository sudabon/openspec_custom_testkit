# シナリオ対応表

| capability | Requirement | Scenario | 分類 | 出所 | 結果 |
|------------|-------------|----------|------|------|------|
| billing/invoice | Invoice listing | Empty cart | 未保護 | - |  |
| billing/invoice | Invoice export | Export CSV | 要再確認 | add-invoice TP-001 ／ change-export で MODIFIED |  |
| billing/invoice | Invoice print | Print invoice | 保護（E2E） | update-print TP-001 |  |
| billing/invoice | Wishlist | Save for later | 未保護 | - |  |
| cart | Add item | Add one item | 保護（E2E） | add-cart TP-001 |  |
| cart | Add item | Add item when out of stock | 保護（他層の宣言） | add-cart 対象外: Oracle O2 / Layer Unit / Method stock service unit test | 宣言のみ（実行結果は未照合） |
| cart | Show total | Show subtotal | 未保護 | 進行中: add-tax |  |
| cart | Show total | Show tax | 未保護 | 進行中: add-tax |  |
| cart | Checkout button | Empty cart | 保護（E2E） | add-cart TP-002 |  |
| cart | Discount code | Apply coupon | 未保護 | - |  |
| cart | Wishlist | Save for later | 未保護 | - |  |
| search | Search | Search by keyword | 要再確認 | legacy-search TP-001 ／ legacy-qe で MODIFIED |  |
| search | Search | Search with no results | 未保護 | - |  |

## 孤立（テストの削除または付け替えを検討）

| change | TP-ID | capability | Requirement | Scenario | 理由 |
|--------|-------|------------|-------------|----------|------|
| add-cart | TP-003 | cart | Coupon | Apply coupon | RENAMED → Discount code（rename-coupon） |
| add-invoice | TP-003 | billing/invoice | Invoice email | Email invoice | REMOVED（drop-email） |

## 対応不明（保護に数えません）

| change | 行 | Requirement | Scenario | 理由 |
|--------|----|-------------|----------|------|
| add-cart | TP-004 | Add item | Nonexistent scenario | delta spec に Add item / Nonexistent scenario がありません |
| add-wishlist | TP-001 | Wishlist | Save for later | delta spec の複数箇所に一致します: billing/invoice / Wishlist, cart / Wishlist |

## 旧形式・対応不明（保護に数えません）

| change | 行 | Requirement | Scenario | 理由 |
|--------|----|-------------|----------|------|
| legacy-search | TP-002 |  |  | TP-ID を対応表の行として解析できません（表の外、見出しまたは列名を確認） |

## 集計

- シナリオ: 13 件（archive 済み change 9 件から集計）
- 保護（E2E）: 3
- 保護（他層の宣言）: 1
- 未保護: 7
- 要再確認: 2
- 孤立: 2 TP
- 対応不明: 2 行 / 旧形式・対応不明: 1 行
- 保護率（E2E）: 3/13（23.1%）
- 保護率（他層の宣言を含む）: 4/13（30.8%）
- 要対応: 11
