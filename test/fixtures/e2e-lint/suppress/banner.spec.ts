import { expect, test } from '@playwright/test';

test('承認済みの例外', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  // e2e-lint-allow weak-assertion RES-1: 表示されること自体が要件（S2）。状態変化はない
  await expect(page.getByRole('banner')).toBeVisible();
});

test('承認待ちの例外', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  // e2e-lint-allow weak-assertion RES-2: Agent が自分で書いた抑止
  await expect(page.getByRole('banner')).toBeVisible();
});

test('存在しない Residual', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  // e2e-lint-allow weak-assertion RES-404: 参照先が無い
  await expect(page.getByRole('banner')).toBeVisible();
});

test('Residual ID が無い', { tag: ['@demo', '@TP-004'] }, async ({ page }) => {
  // e2e-lint-allow weak-assertion: 理由だけを書いた
  await expect(page.getByRole('banner')).toBeVisible();
});

// e2e-lint-allow missing-assertion RES-1: 遷移できること自体を見る煙テスト
test('テスト単位の抑止', { tag: ['@demo', '@TP-005'] }, async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(10);
});

test('効力は直後の 1 文だけ', { tag: ['@demo', '@TP-006'] }, async ({ page }) => {
  // e2e-lint-allow fixed-wait RES-1: 外部アニメーションの完了を待つ
  await page
    .waitForTimeout(100);
  await page.waitForTimeout(200);
  await expect(page.getByRole('status')).toHaveText('完了');
});
