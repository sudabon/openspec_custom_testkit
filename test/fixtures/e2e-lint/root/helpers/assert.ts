import { expect, type Locator, type Page } from '@playwright/test';

export async function expectToast(page: Page, text: string) {
  await expect(page.getByRole('alert')).toHaveText(text);
}

export const expectShown = async (locator: Locator) => {
  await expect(locator).toBeVisible();
};
