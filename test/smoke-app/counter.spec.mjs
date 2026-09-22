import { expect, test } from '@playwright/test';

test('増やすと表示が 1 になる', { tag: ['@smoke-counter', '@TP-001'] }, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '増やす' }).click();
  await expect(page.getByRole('status')).toHaveText('1');
});
