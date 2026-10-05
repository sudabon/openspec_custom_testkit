import { expect, test } from '@playwright/test';

test.describe('注文', { tag: '@demo' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/orders');
  });

  test('一覧に件数が出る @TP-001', async ({ page }) => {
    await expect(page.getByRole('status')).toHaveText('3 件');
  });

  test.describe('詳細', () => {
    test('詳細に金額が出る', { tag: ['@TP-002'], annotation: { type: 'issue', description: 'x' } }, async ({ page }) => {
      await test.step('開く', async () => {
        await page.getByRole('link', { name: '注文 1' }).click();
      });
      await expect(page.getByRole('heading')).toHaveText('注文 1');
    });
  });
});
