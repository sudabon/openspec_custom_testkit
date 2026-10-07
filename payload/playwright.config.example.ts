import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  retries: 1, // リトライ成功 = フレークとして記録される
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.TESTKIT_RESULTS_JSON || 'test-results/e2e-results.json' }],
  ],
  use: {
    trace: 'on-first-retry',
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
  // test-plan の Projects 列にはこの name を書く。必要な project だけ残す。
  // 1 つに絞って実行するには `npx playwright test --project=chromium`。
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
