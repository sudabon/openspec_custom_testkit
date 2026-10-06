import { expect, test } from '@playwright/test';

test('閉じないテンプレート', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  const text = `始まり ${'x'}
  await expect(page.getByRole('status')).toHaveText(text);
});
