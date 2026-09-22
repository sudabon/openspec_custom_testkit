import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: 'counter.spec.mjs',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node server.mjs',
    cwd: here,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
