import { expect, test } from '@playwright/test';

test('待ってから合計を見る', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await page.goto('/cart');
  await page.waitForTimeout(1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  await expect(page.getByRole('status')).toHaveText('合計 100 円');
});
