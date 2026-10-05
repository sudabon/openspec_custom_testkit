import { expect, test } from '@playwright/test';
import { CheckoutPage } from './pages/checkout';
import { expectShown, expectToast as toast } from './helpers/assert';

async function localCheck(page) {
  await expect(page.getByRole('status')).toHaveText('x');
}

test('Page Object で合計を確かめる', { tag: ['@demo', '@TP-001'] }, async ({ page }) => {
  const checkout = new CheckoutPage(page);
  await checkout.open();
  await checkout.expectTotal('合計 100 円');
});

test('別名の helper で通知を確かめる', { tag: ['@demo', '@TP-002'] }, async ({ page }) => {
  await page.getByRole('button', { name: '購入' }).click();
  await toast(page, '購入しました');
});

test('存在確認だけの helper', { tag: ['@demo', '@TP-003'] }, async ({ page }) => {
  await expectShown(page.getByRole('banner'));
});

test('操作だけの Page Object', { tag: ['@demo', '@TP-004'] }, async ({ page }) => {
  await new CheckoutPage(page).open();
});

test('export されていない helper は数えない', { tag: ['@demo', '@TP-005'] }, async ({ page }) => {
  await localCheck(page);
});
