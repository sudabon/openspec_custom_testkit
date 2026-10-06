import { expect, test } from '@playwright/test';

const identity = <T,>(x: T) => x;
test('構文と Locator の値 @demo @TP-001', async ({ page }) => {
  const box = await page.getByRole('button').boundingBox();
  const width = box!.width! / 2;
  if (width) /re/.test('result');
  await page.getByLabel('f').setInputFiles('./a.pdf');
  await page.getByLabel('f').fill('../x');
  const input = page.getByLabel('f');
  await input.fill('//literal');
  await expect(identity(width)).toBe(10);
});
