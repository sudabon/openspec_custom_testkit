import { expect, test } from '@playwright/test';

test('ロールで探す', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await page.getByRole('button', { name: '購入' }).click();
  await page.getByLabel('数量').fill('2');
  await page.getByTestId('summary').getByText('2 点').click();
  await expect(page.getByRole('status')).toHaveText('購入しました');
});
