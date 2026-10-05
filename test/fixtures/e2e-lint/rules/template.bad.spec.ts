import { expect, test } from '@playwright/test';

test('テンプレートの入れ子', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  const label = `合計 ${`${1 + 1} 点`} / ${'test.only'}`;
  const text = `中身: ${await page.locator('.total').textContent()}`;
  await expect(page.getByRole('status')).toHaveText(`${label} ${text}`);
});
