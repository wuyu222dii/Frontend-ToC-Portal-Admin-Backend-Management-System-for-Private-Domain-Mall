import { defineConfig } from '@playwright/test';

if (process.env.B4_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B4 vertical Playwright requires B4_VERTICAL_TEST_MODE=full');
}

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b4-admin-products.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 90_000,
  workers: 1,
  expect: { timeout: 15_000 },
  projects: [
    { name: 'chromium-vertical', use: { viewport: { width: 1280, height: 800 } } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5175',
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
      command: 'pnpm --filter @qingxu/admin-web exec vite --host 127.0.0.1',
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:5175/login',
    },
  ],
});
