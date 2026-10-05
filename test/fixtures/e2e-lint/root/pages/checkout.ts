import { expect, type Page } from '@playwright/test';

export class CheckoutPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/checkout');
  }

  async expectTotal(total: string) {
    await expect(this.page.getByRole('status')).toHaveText(total);
  }

  async expectBanner() {
    await expect(this.page.getByRole('banner')).toBeVisible();
  }
}
