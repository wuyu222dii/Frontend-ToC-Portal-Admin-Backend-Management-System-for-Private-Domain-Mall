import { defineConfig } from '@playwright/test';

if (process.env.B13_VERTICAL_TEST_MODE !== 'full') {
  throw new Error('B13 vertical Playwright requires B13_VERTICAL_TEST_MODE=full');
}
const apiOrigin = process.env.B13_VERTICAL_API_ORIGIN?.trim();
const adminOrigin = process.env.B13_VERTICAL_ADMIN_ORIGIN?.trim();
const agentOrigin = process.env.B13_VERTICAL_AGENT_ORIGIN?.trim();
const miniappOrigin = process.env.B13_VERTICAL_MINIAPP_ORIGIN?.trim();
if (apiOrigin !== 'http://127.0.0.1:3000' || adminOrigin !== 'http://127.0.0.1:5175' ||
  agentOrigin !== 'http://127.0.0.1:5174' || miniappOrigin !== 'http://127.0.0.1:5173') {
  throw new Error('B13 vertical Playwright requires the fixed isolated service origins');
}
const outputDir = process.env.B13_VERTICAL_OUTPUT_DIR?.trim();
if (!outputDir) throw new Error('B13 vertical Playwright requires an isolated output directory');

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
  testMatch: 'b13-agent-finance.vertical.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  preserveOutput: 'never',
  reporter: 'line',
  retries: 0,
  timeout: 120_000,
  workers: 1,
  outputDir,
  expect: { timeout: 20_000 },
  projects: [{
    name: 'chromium-b13-vertical',
    use: { viewport: { width: 1024, height: 768 } },
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
      command: 'pnpm --filter @qingxu/admin-web exec vite --host 127.0.0.1 --port 5175',
      env: frontendEnv,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${adminOrigin}/login`,
    },
    {
      command: 'pnpm --filter @qingxu/agent-web exec vite --host 127.0.0.1 --port 5174',
      env: frontendEnv,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${agentOrigin}/login`,
    },
    {
      command: 'exec node_modules/.bin/uni -p h5 --host 0.0.0.0',
      cwd: 'apps/miniapp',
      env: { ...frontendEnv, MINIAPP_DEV_API_PROXY_TARGET: apiOrigin, MINIAPP_DEV_PORT: '5173' },
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: `${miniappOrigin}/`,
    },
  ],
});
