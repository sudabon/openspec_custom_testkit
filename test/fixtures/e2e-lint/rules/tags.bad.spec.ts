import { expect, test } from '@playwright/test';

test('タグが無い', async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('1');
});

test('TP タグが無い', { tag: '@demo' }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('2');
});

test('change タグが無い', { tag: ['@TP-001'] }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('3');
});
