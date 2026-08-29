import { defineConfig } from '@playwright/test';

if (process.env.B9_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B9 vertical Playwright requires B9_VERTICAL_TEST_MODE=full');
}
const apiPort = process.env.B9_VERTICAL_API_PORT?.trim() || '3000';
const workerPort = process.env.B9_VERTICAL_WORKER_PORT?.trim() || '3001';
const webPort = process.env.B9_VERTICAL_WEB_PORT?.trim() || '5173';
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b9-store-orders.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 180_000,
  workers: 1,
  expect: { timeout: 20_000 },
  projects: [
    { name: 'chromium-b9-vertical', use: { viewport: { width: 390, height: 844 } } },
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
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${apiOrigin}/internal/health`,
    },
    {
      command: 'pnpm --filter @qingxu/worker exec tsx src/main.ts',
      env: {
        ...process.env,
        WORKER_POLL_INTERVAL_MS: '100',
        WORKER_PORT: workerPort,
      },
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${workerOrigin}/internal/health`,
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
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${webOrigin}/`,
    },
  ],
});
