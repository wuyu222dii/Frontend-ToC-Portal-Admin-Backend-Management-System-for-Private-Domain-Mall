import { defineConfig } from '@playwright/test';

if (process.env.B6_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B6 vertical Playwright requires B6_VERTICAL_TEST_MODE=full');
}

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b6-store-catalog.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 15_000 },
  projects: [
    { name: 'chromium-b6-vertical', use: { viewport: { width: 390, height: 844 } } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
  },
  webServer: [
    {
      command: 'pnpm --filter @qingxu/api exec tsx src/main.ts',
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:3000/internal/health',
    },
    {
      command: 'pnpm dev:miniapp',
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:5173/',
    },
  ],
});
