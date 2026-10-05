import { expect, test } from '@playwright/test';

test('操作だけ', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '保存' }).click();
});

test('表示確認だけ', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeVisible();
});

test('soft と poll の存在確認だけ', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  await expect.soft(page.getByRole('banner')).toBeAttached();
  await expect.poll(async () => page.getByRole('row').count()).toBeTruthy();
  expect(await page.title()).not.toBeNull();
  expect(page.url()).toBeDefined();
});
