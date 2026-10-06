import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('期待値で比べる', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('保存しました');
});

test('スクリーンショットで比べる', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  await expect(page).toHaveScreenshot('top.png');
});

test('アクセシビリティ違反が無い', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('poll で件数を比べる', { tag: ['@demo', '@TP-004'] }, async ({ page }) => {
  await expect.poll(async () => page.getByRole('row').count()).toBe(3);
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
