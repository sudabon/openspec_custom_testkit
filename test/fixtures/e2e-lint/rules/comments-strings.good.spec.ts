import { expect, test } from '@playwright/test';

// test.only('コメントの中', async () => {}); page.waitForTimeout(1000)
/* page.locator('.btn') と test.skip はブロックコメントの中 */
const note = 'test.only と page.locator(".x") は文字列の中';
const other = "page.waitForTimeout(1000) も test.fixme も文字列";
const pattern = /page\.locator\(['"]\.btn/g;
const ratio = 10 / 2 / 5;

test('文字列やコメントの一致は指摘しない', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  await page.getByRole('textbox').fill(`${note} ${other} ${ratio}`);
  await expect(page.getByRole('status')).toHaveText(pattern.source);
});
