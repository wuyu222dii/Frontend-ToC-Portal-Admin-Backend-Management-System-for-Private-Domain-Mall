import { defineConfig } from '@playwright/test';

if (process.env.B8_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B8 vertical Playwright requires B8_VERTICAL_TEST_MODE=full');
}
const apiPort = process.env.B8_VERTICAL_API_PORT?.trim() || '3000';
const webPort = process.env.B8_VERTICAL_WEB_PORT?.trim() || '5173';
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b8-store-shopping.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 15_000 },
  projects: [
    { name: 'chromium-b8-vertical', use: { viewport: { width: 390, height: 844 } } },
  ],
  use: {
    baseURL: webOrigin,
    browserName: 'chromium',
    headless: true,
    trace: 'off',
  },
  webServer: [
    {
      command: 'pnpm --filter @qingxu/api exec tsx src/main.ts',
      env: { ...process.env, API_PORT: apiPort },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${apiOrigin}/internal/health`,
    },
    {
      command: 'exec node_modules/.bin/uni -p h5 --host 0.0.0.0',
      cwd: 'apps/miniapp',
      env: {
        ...process.env,
        MINIAPP_DEV_API_PROXY_TARGET: apiOrigin,
        MINIAPP_DEV_PORT: webPort,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${webOrigin}/`,
    },
  ],
});
