import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'b10-miniapp-payments.spec.ts',
  fullyParallel: true,
  reporter: 'line',
  outputDir: 'test-results/b10-miniapp-payments',
  projects: [
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'mobile-414', use: { viewport: { width: 414, height: 896 } } },
    { name: 'web-1024', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'web-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev:miniapp',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
