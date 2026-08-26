import { expect, test } from '@playwright/test';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B6 vertical test`);
  return value;
}

test('browser reaches real Nest, PostgreSQL and MinIO for the anonymous store catalog', async ({ page, request }) => {
  const productName = required('B6_VERTICAL_PRODUCT_NAME');
  const categoryName = required('B6_VERTICAL_CATEGORY_NAME');
  const productId = required('B6_VERTICAL_PRODUCT_ID');
  const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
  const apiResponses: Array<{ path: string; status: number }> = [];
  const storageResponses: Array<{ method: string; path: string; status: number }> = [];

  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === storageOrigin) {
      storageResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
    if (url.pathname.startsWith('/api/v1/')) apiResponses.push({ path: url.pathname, status: response.status() });
  });

  const health = await request.get('http://127.0.0.1:3000/internal/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ service: 'api', status: 'ok' });

  await page.goto('/');
  const homeProduct = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(productName)}，已售`) }).first();
  await expect(homeProduct).toBeVisible();
  await homeProduct.scrollIntoViewIfNeeded();
  const homeImage = homeProduct.locator('img[alt]').first();
  await expect(homeImage).toBeVisible();
  await expect(homeImage).toHaveAttribute('alt', productName);
  await expect.poll(() => homeImage.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    naturalHeight: element.naturalHeight,
    naturalWidth: element.naturalWidth,
  }))).toMatchObject({ complete: true, naturalHeight: 1, naturalWidth: 1 });

  await page.goto('/#/pages/category/index');
  await expect(page.getByText('商品分类')).toBeVisible();
  await expect(page.getByText(categoryName, { exact: true })).toBeVisible();
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();

  await page.goto('/#/pages/search/index');
  await page.locator('.search-field__input input').fill(productName);
  await page.locator('.search-header__submit').click();
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();

  await page.goto(`/#/pages/product/detail?product_id=${productId}`);
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await expect(page.locator('.detail-actions__secondary')).toBeVisible();
  await page.locator('.detail-actions__secondary').click();
  await expect(page.locator('.sku-sheet')).toBeVisible();
  await page.locator('.sku-sheet__confirm').click();

  await page.goto('/#/pages/cart/index');
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/库存 7 件/)).toBeVisible();
  await expect(page.getByText('合计')).toBeVisible();

  expect(apiResponses.some(({ path, status }) => path === '/api/v1/store/home' && status === 200)).toBe(true);
  expect(apiResponses.some(({ path, status }) => path === '/api/v1/store/categories' && status === 200)).toBe(true);
  expect(apiResponses.some(({ path, status }) => path === '/api/v1/store/brands' && status === 200)).toBe(true);
  expect(apiResponses.some(({ path, status }) => path === '/api/v1/store/products' && status === 200)).toBe(true);
  expect(apiResponses.some(({ path, status }) => path === `/api/v1/store/products/${productId}` && status === 200)).toBe(true);
  expect(apiResponses.some(({ path }) => /\/api\/v1\/(?:cart|orders)(?:\/|$)/.test(path))).toBe(false);
  expect(apiResponses.filter(({ status }) => status >= 400)).toEqual([]);
  expect(storageResponses.some(({ method, path, status }) => method === 'GET' && path.includes('/public/') && status === 200)).toBe(true);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
