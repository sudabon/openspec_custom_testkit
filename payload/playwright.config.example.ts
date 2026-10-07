import { defineConfig, devices } from '@playwright/test';

// CI の gate は実行ごとの directory を TESTKIT_RUN_DIR で渡す。添付と HTML レポートをその配下に置くと、
// 今回の実行の artifact に入り、E2E の要約に相対パスで出る。ローカルでは Playwright の既定の場所を使う。
const runDir = process.env.TESTKIT_RUN_DIR;

export default defineConfig({
  testDir: './tests/e2e',
  retries: 1, // リトライ成功 = フレークとして記録される
  outputDir: runDir ? `${runDir}/test-results` : undefined,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.TESTKIT_RESULTS_JSON || 'test-results/e2e-results.json' }],
    ['html', { outputFolder: runDir ? `${runDir}/playwright-report` : 'playwright-report', open: 'never' }],
  ],
  use: {
    // screenshot・video・trace には画面上の個人情報や認証情報が写りうる。テストデータは合成データにする。
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
