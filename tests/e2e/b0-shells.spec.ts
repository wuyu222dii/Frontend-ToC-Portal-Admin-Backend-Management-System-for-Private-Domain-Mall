import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

test('all B0 application shells and health endpoints are reachable', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByText('青序生活', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '商城主导航' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('http://127.0.0.1:5174');
  await expect(page.getByRole('heading', { name: '一级代理工作台' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('http://127.0.0.1:5175');
  await expect(page.getByRole('heading', { name: '总部管理后台' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const api = await request.get('http://127.0.0.1:3000/internal/health');
  expect(api.ok()).toBeTruthy();
  expect(await api.json()).toEqual({ service: 'api', status: 'ok' });

  const worker = await request.get('http://127.0.0.1:3001/internal/health');
  expect(worker.ok()).toBeTruthy();
  expect(await worker.json()).toEqual({ service: 'worker', status: 'ok' });
});
