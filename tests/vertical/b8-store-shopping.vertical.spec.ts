import { expect, test, type Page } from '@playwright/test';

interface MergeCall {
  body: unknown;
  idempotencyKey: string | undefined;
}

interface StoreResponse {
  cacheControl: string | undefined;
  method: string;
  path: string;
  pragma: string | undefined;
  status: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B8 vertical test`);
  return value;
}

function inputByLabel(page: Page, label: string) {
  return page.getByLabel(label).locator('input');
}

function uniButton(page: Page, label: string) {
  return page.locator('uni-button').filter({
    hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`),
  });
}

async function navigate(page: Page, url: string, method: 'navigateTo' | 'reLaunch' = 'navigateTo') {
  await page.evaluate(({ runtimeMethod, target }) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: Record<string, (options: Record<string, unknown>) => unknown>;
    }).uni;
    runtime[runtimeMethod]?.({ fail: reject, success: resolve, url: target });
  }), { runtimeMethod: method, target: url });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(layout.body, layout.document)).toBeLessThanOrEqual(layout.viewport + 1);
}

test('browser completes B8 favorites, loss-safe guest merge, server cart and address through real infrastructure',
  async ({ page, request }) => {
    const loginCode = required('B8_VERTICAL_LOGIN_CODE');
    const apiOrigin = required('B8_VERTICAL_API_ORIGIN');
    const productId = required('B8_VERTICAL_PRODUCT_ID');
    const productName = required('B8_VERTICAL_PRODUCT_NAME');
    const skuId = required('B8_VERTICAL_SKU_ID');
    const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
    const phone = ['138', '0000', '0008'].join('');
    const detail = '文一路 88 号 B8 纵向测试';
    const mergeCalls: MergeCall[] = [];
    const storeResponses: StoreResponse[] = [];
    const storageResponses: Array<{ method: string; path: string; status: number }> = [];
    let loseFirstMergeResponse = true;

    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === storageOrigin) {
        storageResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      }
      if (!url.pathname.startsWith('/api/v1/store/')) return;
      const headers = response.headers();
      storeResponses.push({
        cacheControl: headers['cache-control'],
        method: response.request().method(),
        path: url.pathname,
        pragma: headers.pragma,
        status: response.status(),
      });
    });

    await page.route('**/api/v1/store/cart/merge', async (route) => {
      const request = route.request();
      mergeCalls.push({
        body: request.postDataJSON(),
        idempotencyKey: request.headers()['idempotency-key'],
      });
      if (loseFirstMergeResponse) {
        loseFirstMergeResponse = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    const health = await request.get(`${apiOrigin}/internal/health`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ service: 'api', status: 'ok' });

    await page.goto(`/#/pages/product/detail?product_id=${productId}`);
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    const productImage = page.locator('.detail-gallery .qx-product-image__asset img').first();
    await expect(productImage).toBeVisible();
    await expect.poll(() => productImage.evaluate((element: HTMLImageElement) => ({
      complete: element.complete,
      naturalHeight: element.naturalHeight,
      naturalWidth: element.naturalWidth,
    }))).toMatchObject({ complete: true, naturalHeight: 1, naturalWidth: 1 });

    await page.locator('uni-button.detail-actions__secondary').click();
    await page.locator('.sku-stepper').getByLabel('增加数量').click();
    await uniButton(page, '加入购物车').last().click();
    await expect(page.locator('.sku-sheet')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.stringify(localStorage)))
      .toContain(productName);

    await page.getByLabel('收藏商品').click();
    await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
    await page.getByText('去登录', { exact: true }).last().click();
    await inputByLabel(page, 'Mock 微信 code').fill(loginCode);
    await page.getByLabel('用户协议').click();
    await page.getByLabel('隐私政策').click();
    const loginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/auth/wechat/login');
    await uniButton(page, '微信授权登录').click();
    expect((await loginResponsePromise).status()).toBe(200);

    await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${productId}$`));
    await expect(page.getByLabel('取消收藏')).toBeVisible();
    expect(mergeCalls).toHaveLength(1);

    await navigate(page, '/pages/cart/index', 'reLaunch');
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    await expect(page.locator('.cart-stepper')).toContainText('2');
    await expect.poll(() => mergeCalls.length).toBe(2);
    expect(mergeCalls[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mergeCalls[1]?.idempotencyKey).toBe(mergeCalls[0]?.idempotencyKey);
    expect(mergeCalls[0]?.body).toEqual({
      items: [{ quantity: 2, selected: true, sku_id: skuId }],
    });
    expect(mergeCalls[1]?.body).toEqual(mergeCalls[0]?.body);

    const storageSnapshot = await page.evaluate(() => ({
      entries: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key ?? '', key === null ? null : localStorage.getItem(key)];
      })),
      serialized: JSON.stringify(localStorage),
    }));
    expect(storageSnapshot.serialized).not.toContain(productName);
    expect(storageSnapshot.serialized).not.toContain(phone);
    expect(storageSnapshot.entries['qingxu:store-cart-merge-journal']).toBeUndefined();

    const cartWritePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/v1/store/cart/items/${skuId}` &&
        response.request().method() === 'PUT';
    });
    await page.getByLabel('取消选择商品').click();
    expect((await cartWritePromise).status()).toBe(200);
    await expect(page.getByLabel('选择商品')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await navigate(page, '/pages/favorites/index');
    await expect(page.getByText('商品收藏', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await navigate(page, '/pages/address/index');
    await expect(page.getByText('暂无收货地址', { exact: true })).toBeVisible();
    await uniButton(page, '新增地址').click();
    await expect(page.getByText('新增地址', { exact: true }).first()).toBeVisible();
    await inputByLabel(page, '收货人').fill('纵向用户');
    await inputByLabel(page, '收货手机号').fill(phone);
    await inputByLabel(page, '省').fill('浙江省');
    await inputByLabel(page, '市').fill('杭州市');
    await inputByLabel(page, '区').fill('西湖区');
    await page.getByLabel('详细地址').locator('textarea').fill(detail);
    const addressResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/addresses' &&
        response.request().method() === 'POST');
    await uniButton(page, '保存地址').click();
    expect((await addressResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/pages\/address\/index/);
    await expect(page.getByText('138 **** 0008', { exact: true })).toBeVisible();
    await expect(page.getByText('默认', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(storageResponses.some(({ method, path, status }) =>
      method === 'GET' && path.includes('/public/') && status === 200)).toBe(true);
    const requiredResponses = [
      ['GET', `/api/v1/store/products/${productId}`],
      ['GET', '/api/v1/store/legal-documents'],
      ['POST', '/api/v1/store/auth/wechat/login'],
      ['GET', '/api/v1/store/profile'],
      ['PUT', `/api/v1/store/favorites/${productId}`],
      ['POST', '/api/v1/store/cart/merge'],
      ['PUT', `/api/v1/store/cart/items/${skuId}`],
      ['GET', '/api/v1/store/favorites'],
      ['POST', '/api/v1/store/addresses'],
      ['GET', '/api/v1/store/addresses'],
    ] as const;
    for (const [method, path] of requiredResponses) {
      expect(storeResponses.some((response) =>
        response.method === method && response.path === path && response.status === 200)).toBe(true);
    }
    const personalized = storeResponses.filter(({ path, status }) =>
      status === 200 && !path.startsWith('/api/v1/store/products/') &&
        path !== '/api/v1/store/legal-documents');
    expect(personalized.length).toBeGreaterThan(0);
    expect(personalized.every(({ cacheControl, pragma }) =>
      cacheControl === 'no-store, private' && pragma === 'no-cache')).toBe(true);
  });
