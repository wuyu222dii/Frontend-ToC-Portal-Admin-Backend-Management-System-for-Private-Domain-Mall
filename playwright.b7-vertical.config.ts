import { defineConfig } from '@playwright/test';

if (process.env.B7_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B7 vertical Playwright requires B7_VERTICAL_TEST_MODE=full');
}

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b7-store-identity.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 15_000 },
  projects: [
    { name: 'chromium-b7-vertical', use: { viewport: { width: 390, height: 844 } } },
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
      command: 'exec node_modules/.bin/uni -p h5 --host 0.0.0.0',
      cwd: 'apps/miniapp',
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:5173/',
    },
  ],
});
