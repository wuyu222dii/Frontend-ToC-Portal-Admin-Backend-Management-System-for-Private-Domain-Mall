import { expect, test, type Page, type Route } from '@playwright/test';

const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const SECOND_SKU_ID = '01J80000000000000000000000';
const CUSTOMER_ID = '01J20000000000000000000000';
const BRAND_ID = '01J30000000000000000000000';
const CATEGORY_ID = '01J40000000000000000000000';
const CART_ID = '01J50000000000000000000000';
const FAVORITE_ID = '01J60000000000000000000000';
const ADDRESS_ID = '01J70000000000000000000000';
const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const PHONE = '10000000000';
const LOGIN_CODE = 'mock:b8_ui_customer';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const session = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2099-08-28T12:00:00.000Z',
  refresh_expires_at: '2099-09-04T12:00:00.000Z',
};

function success(data: unknown) {
  return { code: 'OK', message: 'success', data, request_id: 'req_b8_ui' };
}

function failure(code: string, message: string) {
  return { code, message, request_id: 'req_b8_ui_error' };
}

async function fulfill(route: Route, status: number, payload: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store, private', Pragma: 'no-cache', ...headers },
    status,
  });
}

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: Record<string, string>;
}

interface AddressDetail {
  address_id: string;
  city: string;
  detail: string;
  district: string;
  is_default: boolean;
  phone: string;
  province: string;
  recipient_name: string;
  version: number;
}

class MockB8Backend {
  readonly calls: Call[] = [];
  favorite = true;
  favoriteAvailability: 'SALEABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE' = 'SALEABLE';
  favoriteListRateLimitedOnce = false;
  favoriteListFailureOnce = false;
  favoriteMutationConflictOnce = false;
  favoriteMutationDelayMs = 0;
  favoriteStateDelayOnceMs = 0;
  favoriteListItemCount = 1;
  favoriteStateFailurePlan: Array<429 | 500> = [];
  favoritePutProjectionOnce: boolean | null = null;
  addressConflictOnce = false;
  addressCreateConflictOnce = false;
  addressDetailDelayOnceMs = 0;
  addressMutationBusinessErrorOnce = false;
  cartGetFailureOnce = false;
  cartWriteConflictOnce = false;
  cartWriteDelayMs = 0;
  activeCartWrites = 0;
  maxConcurrentCartWrites = 0;
  mergeDelayMs = 0;
  mergeLoseResponseOnce = false;
  mergeUnauthorizedOnce = false;
  readonly mergeFacts = new Map<string, string>();
  cartItems: Array<{ quantity: number; selected: boolean; sku_id: string }> = [
    { quantity: 2, selected: true, sku_id: SKU_ID },
  ];
  address: AddressDetail | null = {
    address_id: ADDRESS_ID,
    recipient_name: '青序用户',
    phone: PHONE,
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    detail: '文一路 1 号',
    is_default: true,
    version: 1,
  };

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  count(path: string, method?: string): number {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method)).length;
  }

  private cartView() {
    const items = this.cartItems.map((item) => ({
      sku_id: item.sku_id,
      product_id: PRODUCT_ID,
      product_name: 'B8 洗护套装',
      sku_name: item.sku_id === SECOND_SKU_ID ? '补充装' : '标准装',
      spec_json: {
        attributes: [{ name: '容量', value: item.sku_id === SECOND_SKU_ID ? '300ml' : '500ml' }],
      },
      primary_image_url: null,
      quantity: item.quantity,
      selected: item.selected,
      retail_price: item.sku_id === SECOND_SKU_ID ? '29.00' : '39.00',
      available_stock: item.sku_id === SECOND_SKU_ID ? 6 : 8,
      sale_status: 'SALEABLE',
    }));
    const amount = items.reduce(
      (total, item) =>
        item.selected
          ? total + (item.sku_id === SECOND_SKU_ID ? 2_900 : 3_900) * item.quantity
          : total,
      0,
    );
    return {
      cart_id: items.length === 0 ? null : CART_ID,
      items,
      total_amount: `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`,
    };
  }

  private favoriteViews() {
    return Array.from({ length: this.favoriteListItemCount }, (_, index) => ({
      favorite_id: index === 0 ? FAVORITE_ID : `01JA${String(index).padStart(22, '0')}`,
      created_at: '2026-08-28T01:00:00.000Z',
      product: {
        product_id: index === 0 ? PRODUCT_ID : `01J9${String(index).padStart(22, '0')}`,
        name: index === 0 ? 'B8 洗护套装' : `B8 收藏商品 ${index + 1}`,
        primary_image_url: null,
        minimum_active_price: index === 0 && this.favoriteAvailability === 'UNAVAILABLE'
          ? null
          : '39.00',
        is_salable: index === 0 ? this.favoriteAvailability === 'SALEABLE' : true,
        availability: index === 0 ? this.favoriteAvailability : 'SALEABLE',
      },
    })).filter((_, index) => index !== 0 || this.favorite);
  }

  private addressSummary() {
    if (this.address === null) return [];
    return [{
      address_id: this.address.address_id,
      recipient_name_masked: '青***',
      phone_masked: '100 **** 0000',
      province: this.address.province,
      city: this.address.city,
      district: this.address.district,
      detail_masked: '文一路 ****',
      is_default: this.address.is_default,
      version: this.address.version,
    }];
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    this.calls.push({
      body,
      headers: request.headers(),
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });

    if (url.pathname === '/api/v1/store/legal-documents' && method === 'GET') {
      await fulfill(route, 200, success({
        user_agreement: { type: 'USER_AGREEMENT', document_version: 'b8-user', title: '用户协议', content_url: 'https://example.invalid/user', required: true },
        privacy_policy: { type: 'PRIVACY_POLICY', document_version: 'b8-privacy', title: '隐私政策', content_url: 'https://example.invalid/privacy', required: true },
        phone_authorization: { type: 'PHONE_AUTHORIZATION', document_version: 'b8-phone', title: '手机号授权说明', content_url: 'https://example.invalid/phone', required: true },
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/wechat/login' && method === 'POST') {
      await fulfill(route, 200, success({ session, confirmation_required: false, candidate: null }));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/refresh' && method === 'POST') {
      await fulfill(route, 401, failure('AUTH_REQUIRED', 'session expired'));
      return;
    }
    if (url.pathname === '/api/v1/store/profile' && method === 'GET') {
      await fulfill(route, 200, success({
        customer_id: CUSTOMER_ID,
        nickname: '青序用户',
        avatar_url: null,
        city: '杭州',
        phone_tail: null,
        phone_masked: null,
        phone_source: null,
        phone_verified_at: null,
        version: 1,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/service-agent' && method === 'GET') {
      await fulfill(route, 200, success(null));
      return;
    }
    if (url.pathname === `/api/v1/store/products/${PRODUCT_ID}` && method === 'GET') {
      await fulfill(route, 200, success({
        product_id: PRODUCT_ID,
        spu_code: 'B8-SPU',
        name: 'B8 洗护套装',
        subtitle: '登录购物基础验收商品',
        introduction: '用于 B8.4 界面验收。',
        ingredients: null,
        usage_method: null,
        brand: { brand_id: BRAND_ID, name: '青序', description: null, logo_url: null, sort_order: 0 },
        category: { category_id: CATEGORY_ID, name: '洗护', icon_url: null, sort_order: 0 },
        images: [],
        skus: [{
          sku_id: SKU_ID,
          code: 'B8-SKU',
          name: '标准装',
          spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
          retail_price: '39.00',
          is_recommended: true,
          available_stock: 8,
          is_salable: true,
        }],
        net_sales_count: 8,
        is_hot: true,
        is_new: false,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/favorites' && method === 'GET') {
      if (this.favoriteListRateLimitedOnce) {
        this.favoriteListRateLimitedOnce = false;
        await fulfill(route, 429, failure('RATE_LIMITED', 'retry later'), { 'Retry-After': '2' });
        return;
      }
      if (this.favoriteListFailureOnce) {
        this.favoriteListFailureOnce = false;
        await fulfill(route, 500, failure('INTERNAL_ERROR', 'favorite list failed'));
        return;
      }
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('page_size') ?? '20');
      const favorites = this.favoriteViews();
      await fulfill(route, 200, success({
        items: favorites.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        pagination: { page: pageNumber, page_size: pageSize, total: favorites.length },
      }));
      return;
    }
    if (url.pathname === `/api/v1/store/favorites/${PRODUCT_ID}` &&
      ['DELETE', 'GET', 'PUT'].includes(method)) {
      if (method === 'GET' && this.favoriteStateFailurePlan.length > 0) {
        const status = this.favoriteStateFailurePlan.shift();
        if (status === 429) {
          await fulfill(route, 429, failure('RATE_LIMITED', 'retry later'), { 'Retry-After': '1' });
        } else {
          await fulfill(route, 500, failure('INTERNAL_ERROR', 'favorite state failed'));
        }
        return;
      }
      if (method === 'GET' && this.favoriteStateDelayOnceMs > 0) {
        const snapshot = this.favorite;
        const wait = this.favoriteStateDelayOnceMs;
        this.favoriteStateDelayOnceMs = 0;
        await delay(wait);
        await fulfill(route, 200, success({ product_id: PRODUCT_ID, is_favorite: snapshot }));
        return;
      }
      if (method !== 'GET' && this.favoriteMutationConflictOnce) {
        this.favoriteMutationConflictOnce = false;
        await fulfill(route, 409, failure('STATE_CONFLICT', 'favorite changed'));
        return;
      }
      if (method !== 'GET' && this.favoriteMutationDelayMs > 0) {
        await delay(this.favoriteMutationDelayMs);
      }
      if (method === 'PUT' && this.favoritePutProjectionOnce !== null) {
        this.favorite = this.favoritePutProjectionOnce;
        this.favoritePutProjectionOnce = null;
      } else if (method === 'PUT') this.favorite = true;
      if (method === 'DELETE') this.favorite = false;
      await fulfill(route, 200, success({ product_id: PRODUCT_ID, is_favorite: this.favorite }));
      return;
    }
    if (url.pathname === '/api/v1/store/cart/merge' && method === 'POST') {
      if (this.mergeUnauthorizedOnce) {
        this.mergeUnauthorizedOnce = false;
        await fulfill(route, 401, failure('AUTH_REQUIRED', 'session expired'));
        return;
      }
      const idempotencyKey = request.headers()['idempotency-key'] ?? '';
      const fingerprint = JSON.stringify(body);
      const existingFingerprint = this.mergeFacts.get(idempotencyKey);
      if (existingFingerprint !== undefined && existingFingerprint !== fingerprint) {
        await fulfill(route, 409, failure('IDEMPOTENCY_KEY_REUSED', 'body changed'));
        return;
      }
      const incoming = Array.isArray(body?.items)
        ? body.items as Array<{ quantity: number; selected: boolean; sku_id: string }>
        : [];
      if (existingFingerprint === undefined) {
        this.mergeFacts.set(idempotencyKey, fingerprint);
        for (const item of incoming) {
          const existing = this.cartItems.find((current) => current.sku_id === item.sku_id);
          if (existing) {
            existing.quantity = Math.min(99, existing.quantity + item.quantity);
            existing.selected = existing.selected || item.selected;
          } else this.cartItems.push({ ...item });
        }
      }
      if (this.mergeDelayMs > 0) await delay(this.mergeDelayMs);
      if (this.mergeLoseResponseOnce) {
        this.mergeLoseResponseOnce = false;
        await route.abort('failed');
        return;
      }
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    if (url.pathname === '/api/v1/store/cart' && method === 'GET') {
      if (this.cartGetFailureOnce) {
        this.cartGetFailureOnce = false;
        await fulfill(route, 500, failure('INTERNAL_ERROR', 'cart unavailable'));
        return;
      }
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    const cartItemSkuId = [SKU_ID, SECOND_SKU_ID].find(
      (skuId) => url.pathname === `/api/v1/store/cart/items/${skuId}`,
    );
    if (cartItemSkuId && method === 'PUT') {
      if (this.cartWriteConflictOnce) {
        this.cartWriteConflictOnce = false;
        await fulfill(route, 409, failure('STATE_CONFLICT', 'cart changed'));
        return;
      }
      this.activeCartWrites += 1;
      this.maxConcurrentCartWrites = Math.max(this.maxConcurrentCartWrites, this.activeCartWrites);
      try {
        if (this.cartWriteDelayMs > 0) await delay(this.cartWriteDelayMs);
        const input = body as { quantity: number; selected: boolean };
        const itemIndex = this.cartItems.findIndex(({ sku_id }) => sku_id === cartItemSkuId);
        const nextItem = {
          sku_id: cartItemSkuId,
          quantity: input.quantity,
          selected: input.selected,
        };
        if (itemIndex === -1) this.cartItems.push(nextItem);
        else this.cartItems.splice(itemIndex, 1, nextItem);
        await fulfill(route, 200, success(this.cartView()));
      } finally {
        this.activeCartWrites -= 1;
      }
      return;
    }
    if (cartItemSkuId && method === 'DELETE') {
      this.cartItems = this.cartItems.filter(({ sku_id }) => sku_id !== cartItemSkuId);
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    if (url.pathname === '/api/v1/store/addresses' && method === 'GET') {
      await fulfill(route, 200, success(this.addressSummary()));
      return;
    }
    if (url.pathname === '/api/v1/store/addresses' && method === 'POST') {
      if (this.addressCreateConflictOnce) {
        this.addressCreateConflictOnce = false;
        await fulfill(route, 409, failure('STATE_CONFLICT', 'create result unknown'));
        return;
      }
      const input = body as Omit<AddressDetail, 'address_id' | 'version'>;
      this.address = { ...input, address_id: ADDRESS_ID, is_default: true, version: 1 };
      await fulfill(route, 200, success(this.address));
      return;
    }
    if (url.pathname === `/api/v1/store/addresses/${ADDRESS_ID}` && method === 'GET') {
      if (this.address === null) {
        await fulfill(route, 404, failure('RESOURCE_NOT_FOUND', 'address missing'));
      } else {
        if (this.addressDetailDelayOnceMs > 0) {
          const wait = this.addressDetailDelayOnceMs;
          this.addressDetailDelayOnceMs = 0;
          await delay(wait);
        }
        await fulfill(route, 200, success(this.address));
      }
      return;
    }
    if (url.pathname === `/api/v1/store/addresses/${ADDRESS_ID}` && method === 'PATCH') {
      if (this.addressConflictOnce) {
        this.addressConflictOnce = false;
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'address changed'));
        return;
      }
      if (this.addressMutationBusinessErrorOnce) {
        this.addressMutationBusinessErrorOnce = false;
        await fulfill(route, 422, failure('DEFAULT_ADDRESS_REQUIRED', 'default required'));
        return;
      }
      const input = body as Omit<AddressDetail, 'address_id' | 'version'>;
      this.address = { ...input, address_id: ADDRESS_ID, version: (this.address?.version ?? 0) + 1 };
      await fulfill(route, 200, success(this.address));
      return;
    }
    if (url.pathname === `/api/v1/store/addresses/${ADDRESS_ID}` && method === 'DELETE') {
      const version = this.address?.version ?? 1;
      this.address = null;
      await fulfill(route, 200, success({
        resource_type: 'customer_address', resource_id: ADDRESS_ID, status: 'DELETED',
        version: version + 1, occurred_at: '2026-08-28T02:00:00.000Z',
      }));
      return;
    }

    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE', `${method} ${url.pathname}`));
  }
}

function inputByLabel(page: Page, label: string) {
  return page.getByLabel(label).locator('input');
}

function uniButton(page: Page, label: string) {
  return page.locator('uni-button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
}

async function login(page: Page): Promise<void> {
  await page.goto('/#/pages/auth/login');
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
}

async function fillAddress(page: Page, addressDetail = '文一路 99 号'): Promise<void> {
  await inputByLabel(page, '收货人').fill('青序用户');
  await inputByLabel(page, '收货手机号').fill(PHONE);
  await inputByLabel(page, '省').fill('浙江省');
  await inputByLabel(page, '市').fill('杭州市');
  await inputByLabel(page, '区').fill('西湖区');
  await page.getByLabel('详细地址').locator('textarea').fill(addressDetail);
}

async function navigate(page: Page, url: string, method: 'navigateTo' | 'reLaunch' = 'navigateTo') {
  await page.evaluate(({ target, runtimeMethod }) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: Record<string, (options: Record<string, unknown>) => unknown>;
    }).uni;
    runtime[runtimeMethod]?.({ fail: reject, success: resolve, url: target });
  }), { target: url, runtimeMethod: method });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(layout.body, layout.document)).toBeLessThanOrEqual(layout.viewport + 1);
}

test('B8.4 authenticated shopping surfaces fit every acceptance viewport', async ({ page }, testInfo) => {
  const backend = new MockB8Backend();
  await backend.install(page);
  await login(page);

  await page.getByLabel('商品收藏').click();
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('favorites.png') });

  await page.getByLabel('返回').click();
  await page.getByLabel('收货地址').click();
  await expect(page.getByText('100 **** 0000', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('addresses.png') });

  await page.getByLabel('编辑 青*** 的地址').click();
  await expect(inputByLabel(page, '收货手机号')).toHaveValue(PHONE);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('address-edit.png') });

  await navigate(page, '/pages/cart/index', 'reLaunch');
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('cart.png') });

  expect(backend.calls.some(({ path }) => /\/checkout|\/orders/.test(path))).toBe(false);
});

test('B8.4 resumes favorite once and merges the exact guest cart once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Mutation flow runs once; viewport matrix is above.');
  const backend = new MockB8Backend();
  backend.favorite = false;
  backend.cartItems = [];
  backend.address = null;
  backend.mergeLoseResponseOnce = true;
  await backend.install(page);

  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();
  await page.locator('uni-button.detail-actions__secondary').click();
  await page.locator('.sku-stepper').getByLabel('增加数量').click();
  await uniButton(page, '加入购物车').last().click();
  await page.getByLabel('收藏商品').click();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  await page.getByText('去登录', { exact: true }).last().click();
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
  await expect(page.getByLabel('取消收藏')).toBeVisible();
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(1);
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);
  const mergeCall = backend.calls.find(({ method, path }) => method === 'POST' && path.endsWith('/cart/merge'));
  expect(mergeCall?.body).toEqual({ items: [{ sku_id: SKU_ID, quantity: 2, selected: true }] });

  await navigate(page, '/pages/cart/index', 'reLaunch');
  await expect(page.locator('.cart-stepper')).toContainText('2');
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(2);
  const mergeCalls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/cart/merge');
  expect(mergeCalls[0]?.headers['idempotency-key']).toBe(mergeCalls[1]?.headers['idempotency-key']);
  expect(mergeCalls[0]?.body).toEqual(mergeCalls[1]?.body);
  expect(backend.cartItems).toEqual([{ sku_id: SKU_ID, quantity: 2, selected: true }]);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('merged-cart.png') });
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('B8 洗护套装');
});

test('B8.4 recovers a 429 and preserves address input on a 409 without replay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Error matrix runs once; viewport matrix is above.');
  const backend = new MockB8Backend();
  backend.favoriteListRateLimitedOnce = true;
  backend.addressConflictOnce = true;
  await backend.install(page);
  await login(page);

  await page.getByLabel('商品收藏').click();
  await expect(page.getByText('收藏加载失败', { exact: true })).toBeVisible();
  await uniButton(page, '重新加载').click();
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();

  await page.getByLabel('返回').click();
  await page.getByLabel('收货地址').click();
  await page.getByLabel('编辑 青*** 的地址').click();
  const detail = page.getByLabel('详细地址').locator('textarea');
  await detail.fill('文一路 99 号');
  await uniButton(page, '保存地址').click();
  await expect(page.getByText(/不会自动覆盖/, { exact: false })).toBeVisible();
  await expect(detail).toHaveValue('文一路 99 号');
  expect(backend.count(`/api/v1/store/addresses/${ADDRESS_ID}`, 'PATCH')).toBe(1);
  await uniButton(page, '加载最新地址').click();
  await detail.fill('文一路 99 号');
  await uniButton(page, '保存地址').click();
  await expect(page).toHaveURL(/\/pages\/address\/index/);
  expect(backend.count(`/api/v1/store/addresses/${ADDRESS_ID}`, 'PATCH')).toBe(2);
  await page.getByLabel('删除 青*** 的地址').click();
  await page.getByText('删除', { exact: true }).last().click();
  await expect(page.getByText('暂无收货地址', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('B8.4 reloads an address after authentication instead of remaining in loading', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Authentication resume flow runs once.');
  const backend = new MockB8Backend();
  await backend.install(page);

  await page.goto(`/#/pages/address/edit?address_id=${ADDRESS_ID}`);
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(new RegExp(`/pages/address/edit\\?address_id=${ADDRESS_ID}$`));
  await expect(inputByLabel(page, '收货手机号')).toHaveValue(PHONE);
  await expect(page.getByText('正在读取本人地址详情。', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('B8.4 leaves protected pages after login cancellation without a redirect loop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Authentication cancellation flow runs once.');
  const backend = new MockB8Backend();
  await backend.install(page);

  await page.goto('/#/pages/favorites/index');
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await page.getByLabel('返回').click();
  await expect(page).toHaveURL(/\/pages\/favorites\/index/);
  await expect(page.getByText('登录后查看收藏', { exact: true })).toBeVisible();
  await delay(150);
  await expect(page).toHaveURL(/\/pages\/favorites\/index/);

  await page.goto(`/#/pages/address/edit?address_id=${ADDRESS_ID}`);
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await page.getByLabel('返回').click();
  await expect(page).toHaveURL(new RegExp(`/pages/address/edit\\?address_id=${ADDRESS_ID}$`));
  await expect(page.getByText('登录后编辑地址', { exact: true })).toBeVisible();
  await delay(150);
  await expect(page).toHaveURL(new RegExp(`/pages/address/edit\\?address_id=${ADDRESS_ID}$`));

  await page.goto('/#/pages/address/index');
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await page.getByLabel('返回').click();
  await expect(page).toHaveURL(/\/pages\/address\/index/);
  await expect(page.getByText('登录后查看地址', { exact: true })).toBeVisible();
  await delay(150);
  await expect(page).toHaveURL(/\/pages\/address\/index/);
});

test('B8.4 serializes favorite writes and handles search, unavailable and conflict states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Favorite behavior matrix runs once.');
  const backend = new MockB8Backend();
  backend.favoriteStateDelayOnceMs = 1_000;
  backend.favoriteMutationDelayMs = 150;
  await backend.install(page);
  await login(page);

  await navigate(page, `/pages/product/detail?product_id=${PRODUCT_ID}`);
  const favoriteButton = page.locator('uni-button.detail-actions__favorite');
  await expect(favoriteButton).toHaveAttribute('disabled', 'true');
  await expect(favoriteButton).toHaveAttribute('aria-label', '取消收藏');
  await favoriteButton.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(favoriteButton).toHaveAttribute('aria-label', '收藏商品');
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'DELETE')).toBe(1);

  backend.favoriteMutationConflictOnce = true;
  await favoriteButton.click();
  await expect(favoriteButton).toHaveAttribute('aria-label', '收藏商品');
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);

  backend.favorite = true;
  backend.favoriteAvailability = 'UNAVAILABLE';
  await navigate(page, '/pages/favorites/index');
  const search = page.getByRole('searchbox');
  await search.fill('  B8 洗护  ');
  await uniButton(page, '搜索').click();
  await expect(page.getByText('商品已失效', { exact: true })).toBeVisible();
  const queryCall = backend.calls.filter(({ method, path }) =>
    method === 'GET' && path === '/api/v1/store/favorites').at(-1);
  expect(queryCall?.query.keyword).toBe('B8 洗护');
  await expect(page.getByLabel('B8 洗护套装，商品已失效')).toHaveAttribute('disabled', 'true');

  backend.favoriteListFailureOnce = true;
  await uniButton(page, '搜索').click();
  await expect(page.getByText('收藏加载失败', { exact: true })).toBeVisible();
  await uniButton(page, '重新加载').click();
  await expect(page.getByText('商品已失效', { exact: true })).toBeVisible();
});

test('B8.5 retries a failed favorite next page and suppresses duplicate list removal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Favorite pagination and mutation run once.');
  const backend = new MockB8Backend();
  backend.favoriteListItemCount = 21;
  await backend.install(page);
  await login(page);
  await navigate(page, '/pages/favorites/index');

  await expect(page.getByText('21 件', { exact: true })).toBeVisible();
  await expect(page.getByText('B8 收藏商品 20', { exact: true })).toBeVisible();
  await expect(page.getByText('B8 收藏商品 21', { exact: true })).toHaveCount(0);
  backend.favoriteListFailureOnce = true;
  await uniButton(page, '加载更多').click();
  await expect(page.getByText('下一页加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();
  await uniButton(page, '重新加载').click();
  await expect(page.getByText('B8 收藏商品 21', { exact: true })).toBeVisible();
  await expect(page.getByText('已展示全部收藏', { exact: true })).toBeVisible();

  backend.favoriteMutationDelayMs = 250;
  const removeFavorite = page.getByLabel('取消收藏B8 洗护套装');
  await removeFavorite.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByText('B8 洗护套装', { exact: true })).toHaveCount(0);
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'DELETE')).toBe(1);
  await expect(page.getByText('20 件', { exact: true })).toBeVisible();
});

test('B8.5 recovers the product favorite projection after consecutive 429 and 500 responses', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Favorite state recovery runs once.');
  const backend = new MockB8Backend();
  backend.favoriteStateFailurePlan = [429, 500];
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/product/detail?product_id=${PRODUCT_ID}`);

  const favoriteButton = page.locator('uni-button.detail-actions__favorite');
  await expect(favoriteButton).toHaveAttribute('aria-label', '重新加载收藏状态');
  await favoriteButton.click();
  await expect.poll(() => backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'GET')).toBe(2);
  await expect(favoriteButton).toHaveAttribute('aria-label', '重新加载收藏状态');
  await favoriteButton.click();
  await expect(favoriteButton).toHaveAttribute('aria-label', '取消收藏');
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'GET')).toBe(3);
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(0);
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'DELETE')).toBe(0);
});

test('B8.5 honors an is_favorite false projection when resuming a protected favorite', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Favorite login recovery runs once.');
  const backend = new MockB8Backend();
  backend.favorite = false;
  backend.favoritePutProjectionOnce = false;
  await backend.install(page);

  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();
  await page.locator('uni-button.detail-actions__favorite').click();
  await page.getByText('去登录', { exact: true }).last().click();
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
  await expect(page.getByText('收藏状态已变化，请再次操作', { exact: true })).toBeVisible();
  await expect(page.locator('uni-button.detail-actions__favorite')).toHaveAttribute(
    'aria-label',
    '收藏商品',
  );
  expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);
});

test('B8.5 serializes delayed server-cart writes globally across two SKUs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Global cart serialization runs once.');
  const backend = new MockB8Backend();
  backend.cartItems = [
    { quantity: 2, selected: true, sku_id: SKU_ID },
    { quantity: 1, selected: true, sku_id: SECOND_SKU_ID },
  ];
  backend.cartWriteDelayMs = 800;
  await backend.install(page);
  await login(page);
  await navigate(page, '/pages/cart/index', 'reLaunch');

  const itemChecks = page.locator('uni-button.cart-item__check');
  await expect(itemChecks).toHaveCount(2);
  await itemChecks.evaluateAll((elements) => {
    for (const element of elements) (element as HTMLElement).click();
  });
  await expect.poll(() => backend.calls.filter(({ method, path }) =>
    method === 'PUT' && path.startsWith('/api/v1/store/cart/items/')).length).toBe(1);
  await expect(itemChecks.nth(1)).toHaveAttribute('disabled', 'true');
  await expect(itemChecks.nth(0)).toHaveAttribute('aria-label', '选择商品');
  await expect(itemChecks.nth(1)).toHaveAttribute('aria-label', '取消选择商品');

  await itemChecks.nth(1).click();
  await expect(itemChecks.nth(0)).toHaveAttribute('aria-label', '选择商品');
  await expect(itemChecks.nth(1)).toHaveAttribute('aria-label', '选择商品');
  expect(backend.calls.filter(({ method, path }) =>
    method === 'PUT' && path.startsWith('/api/v1/store/cart/items/'))).toHaveLength(2);
  expect(backend.maxConcurrentCartWrites).toBe(1);
  expect(backend.cartItems).toEqual([
    { quantity: 2, selected: false, sku_id: SKU_ID },
    { quantity: 1, selected: false, sku_id: SECOND_SKU_ID },
  ]);
});

test('B8.4 retries authenticated add-to-cart with the same command after response loss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Ambiguous add-to-cart flow runs once.');
  const backend = new MockB8Backend();
  backend.cartItems = [];
  backend.mergeDelayMs = 100;
  backend.mergeLoseResponseOnce = true;
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/product/detail?product_id=${PRODUCT_ID}`);

  await uniButton(page, '加入购物车').first().click();
  await page.locator('.sku-stepper').getByLabel('增加数量').click();
  const confirm = page.locator('uni-button.sku-sheet__confirm');
  await confirm.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(confirm).not.toHaveAttribute('disabled', 'true');
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(1);
  await confirm.evaluate((element: HTMLElement) => element.click());
  await expect.poll(() => backend.count('/api/v1/store/cart/merge', 'POST')).toBe(2);
  await expect(page.locator('.sku-sheet')).toHaveCount(0);

  const calls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/cart/merge');
  expect(calls).toHaveLength(2);
  expect(calls[0]?.headers['idempotency-key']).toBe(calls[1]?.headers['idempotency-key']);
  expect(calls[0]?.body).toEqual(calls[1]?.body);
  expect(calls[0]?.body).toEqual({ items: [{ sku_id: SKU_ID, quantity: 2, selected: true }] });
  expect(backend.cartItems).toEqual([{ sku_id: SKU_ID, quantity: 2, selected: true }]);
});

test('B8.4 never falls back to the guest cart after an authenticated add receives 401', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Authenticated cart authority runs once.');
  const backend = new MockB8Backend();
  backend.cartItems = [];
  backend.mergeUnauthorizedOnce = true;
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/product/detail?product_id=${PRODUCT_ID}`);

  await uniButton(page, '加入购物车').first().click();
  const confirm = page.locator('uni-button.sku-sheet__confirm');
  await confirm.click();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(1);
  await page.getByText('暂不登录', { exact: true }).last().click();

  await confirm.click();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(1);
  expect(JSON.stringify(await page.evaluate(() => localStorage))).not.toContain('B8 洗护套装');
  await page.getByText('去登录', { exact: true }).last().click();
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
  await confirm.click();
  await expect.poll(() => backend.count('/api/v1/store/cart/merge', 'POST')).toBe(2);
  const mergeCalls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/cart/merge');
  expect(mergeCalls[0]?.headers['idempotency-key']).toBe(mergeCalls[1]?.headers['idempotency-key']);
  expect(mergeCalls[0]?.body).toEqual(mergeCalls[1]?.body);
  expect(backend.cartItems).toEqual([{ sku_id: SKU_ID, quantity: 1, selected: true }]);
  expect(JSON.stringify(await page.evaluate(() => localStorage))).not.toContain('B8 洗护套装');
});

test('B8.4 keeps the server cart authoritative through 500 and 409 responses', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Cart error matrix runs once.');
  const backend = new MockB8Backend();
  backend.cartGetFailureOnce = true;
  await backend.install(page);
  await login(page);
  await navigate(page, '/pages/cart/index', 'reLaunch');

  await expect(page.getByText('服务端购物车加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('购物车还是空的', { exact: true })).toHaveCount(0);
  await uniButton(page, '重新加载').click();
  await expect(page.getByText('B8 洗护套装', { exact: true })).toBeVisible();

  backend.cartWriteConflictOnce = true;
  await page.getByLabel('取消选择商品').click();
  await expect(page.getByLabel('取消选择商品')).toBeVisible();
  expect(backend.count(`/api/v1/store/cart/items/${SKU_ID}`, 'PUT')).toBe(1);
});

test('B8.4 handles address create conflict, business validation and slow owner detail without persisting PII', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Address behavior matrix runs once.');
  const backend = new MockB8Backend();
  await backend.install(page);
  await login(page);

  backend.addressCreateConflictOnce = true;
  await navigate(page, '/pages/address/edit');
  await fillAddress(page);
  await uniButton(page, '保存地址').click();
  await expect(page.getByText(/避免重复提交/, { exact: false })).toBeVisible();
  await expect(inputByLabel(page, '收货手机号')).toHaveValue(PHONE);
  const localStorageSnapshot = JSON.stringify(await page.evaluate(() => localStorage));
  expect(localStorageSnapshot).not.toContain(PHONE);
  expect(localStorageSnapshot).not.toContain('青序用户');
  expect(localStorageSnapshot).not.toContain('文一路 99 号');
  await uniButton(page, '返回地址列表确认').click();
  await expect(page).toHaveURL(/\/pages\/address\/index/);
  await expect.poll(() => backend.count('/api/v1/store/addresses', 'GET')).toBe(1);

  backend.address = { ...backend.address!, is_default: false };
  await navigate(page, '/pages/address/index');
  await page.getByLabel('将 青*** 的地址设为默认').click();
  await expect(page.getByText('已设为默认地址。', { exact: true })).toBeVisible();
  expect(backend.calls.some(({ headers, method, path }) =>
    method === 'PATCH' && path.endsWith(ADDRESS_ID) && headers['if-match'] === '"1"')).toBe(true);

  backend.addressDetailDelayOnceMs = 1_800;
  await page.getByLabel('编辑 青*** 的地址').click();
  await expect(page.getByText('网络响应较慢，正在继续读取本人地址。', { exact: true })).toBeVisible();
  await expect(inputByLabel(page, '收货手机号')).toHaveValue(PHONE);
  backend.addressMutationBusinessErrorOnce = true;
  await page.getByLabel('设为默认地址').click();
  await uniButton(page, '保存地址').click();
  await expect(page.getByText(/必须保留一个默认地址/, { exact: false })).toBeVisible();
});
