import { expect, test } from '@playwright/test';

test('CSS で探す', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await page.locator('.btn').click();
  const first = await page.$('#first');
  const items = await page.$$('li');
  await page.getByRole('row').locator('td').first().click();
  await page.waitForSelector('//div[@id="total"]');
  await expect(page.getByRole('status')).toHaveText(String(items.length + (first ? 1 : 0)));
});
