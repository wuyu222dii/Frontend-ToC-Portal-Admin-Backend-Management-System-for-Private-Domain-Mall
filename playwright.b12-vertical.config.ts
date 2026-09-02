import { defineConfig } from '@playwright/test';

if (process.env.B12_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B12 vertical Playwright requires B12_VERTICAL_TEST_MODE=full');
}

const outputDir = process.env.B12_VERTICAL_OUTPUT_DIR?.trim();
if (!outputDir) throw new Error('B12 vertical Playwright requires an isolated output directory');

const apiPort = process.env.B12_VERTICAL_API_PORT?.trim() || '3000';
const workerPort = process.env.B12_VERTICAL_WORKER_PORT?.trim() || '3001';
const miniappPort = process.env.B12_VERTICAL_MINIAPP_PORT?.trim() || '5173';
const adminPort = process.env.B12_VERTICAL_ADMIN_PORT?.trim() || '5175';
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const miniappOrigin = `http://127.0.0.1:${miniappPort}`;
const adminOrigin = `http://127.0.0.1:${adminPort}`;
const backendEnv = {
  ...process.env,
  B12_VERTICAL_EPHEMERAL_SECRET_PATH: '',
  B12_VERTICAL_FIXTURE_PATH: '',
  B12_VERTICAL_OUTPUT_DIR: '',
};
const frontendEnvironmentAllowlist = new Set([
  'CI', 'COREPACK_HOME', 'FORCE_COLOR', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'NODE_ENV',
  'NO_COLOR', 'PATH', 'PNPM_HOME', 'PWD', 'SHELL', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'USER',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
]);
const frontendEnv = Object.fromEntries(Object.keys(process.env).map((name) => [
  name,
  frontendEnvironmentAllowlist.has(name) ? process.env[name] ?? '' : '',
]));

export default defineConfig({
  testDir: './tests/vertical',
  testMatch: 'b12-aftersales.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  timeout: 360_000,
  workers: 1,
  outputDir,
  expect: { timeout: 20_000 },
  projects: [{
    name: 'chromium-b12-vertical',
    use: { launchOptions: { args: ['--deny-permission-prompts'] }, viewport: { width: 390, height: 844 } },
  }],
  use: {
    baseURL: adminOrigin,
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'pnpm --filter @qingxu/api exec tsx src/main.ts',
      env: { ...backendEnv, API_PORT: apiPort },
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${apiOrigin}/internal/health`,
    },
    {
      command: 'pnpm --filter @qingxu/worker exec tsx src/main.ts',
      env: { ...backendEnv, WORKER_POLL_INTERVAL_MS: '100', WORKER_PORT: workerPort },
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${workerOrigin}/internal/health`,
    },
    {
      command: `pnpm --filter @qingxu/admin-web exec vite --host 127.0.0.1 --port ${adminPort}`,
      env: frontendEnv,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${adminOrigin}/login`,
    },
    {
      command: 'exec node_modules/.bin/uni -p h5 --host 0.0.0.0',
      cwd: 'apps/miniapp',
      env: { ...frontendEnv, MINIAPP_DEV_API_PROXY_TARGET: apiOrigin, MINIAPP_DEV_PORT: miniappPort },
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${miniappOrigin}/`,
    },
  ],
});
