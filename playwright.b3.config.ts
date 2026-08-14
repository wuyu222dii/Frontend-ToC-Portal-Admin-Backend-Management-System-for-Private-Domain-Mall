import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'b3-admin-catalog.spec.ts',
  fullyParallel: true,
  reporter: 'line',
  projects: [
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'mobile-414', use: { viewport: { width: 414, height: 896 } } },
    { name: 'web-1024', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'web-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  use: {
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev:admin',
    port: 5175,
    reuseExistingServer: !process.env.CI,
  },
});
