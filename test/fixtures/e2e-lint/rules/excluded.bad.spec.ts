import { expect, test } from '@playwright/test';

test.skip('飛ばした TP', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('1');
});

test.fixme('直す予定の TP', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('2');
});

test.only('これだけ実行', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('3');
});

test.fail('失敗を期待する', { tag: ['@demo', '@TP-004'] }, async ({ page }) => {
  await expect(page.getByRole('status')).toHaveText('4');
});

test('条件つきで飛ばす', { tag: ['@demo', '@TP-005'] }, async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'webkit では未対応');
  await expect(page.getByRole('status')).toHaveText('5');
});

test.describe.skip('飛ばしたグループ', () => {
  test('グループ内の TP', { tag: ['@demo', '@TP-006'] }, async ({ page }) => {
    await expect(page.getByRole('status')).toHaveText('6');
  });
});

test.describe.only('これだけのグループ', () => {
  test('有効な TP', { tag: ['@demo', '@TP-007'] }, async ({ page }) => {
    await expect(page.getByRole('status')).toHaveText('7');
  });
});
