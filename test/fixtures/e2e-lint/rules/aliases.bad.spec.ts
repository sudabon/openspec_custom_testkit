import { test as base } from '@playwright/test';
const it2 = base.extend<{ value: number }>({ value: 1 });
it2.skip(process.env.CI);
it2('別名でも検査 @demo @TP-001', async ({ page }) => {
  await page.getByRole('button').click();
});
