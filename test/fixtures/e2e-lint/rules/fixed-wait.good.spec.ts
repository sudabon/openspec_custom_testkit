import { expect, test } from '@playwright/test';

test('自動待機で合計を見る', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/cart');
  await expect(page.getByRole('status')).toHaveText('合計 100 円', { timeout: 10_000 });
});
