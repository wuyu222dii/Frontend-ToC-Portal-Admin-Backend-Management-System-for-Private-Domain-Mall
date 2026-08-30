import { expect, test, type Page, type Route } from '@playwright/test';

const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const CUSTOMER_ID = '01J20000000000000000000000';
const BRAND_ID = '01J30000000000000000000000';
const CATEGORY_ID = '01J40000000000000000000000';
const CART_ID = '01J50000000000000000000000';
const ADDRESS_ID = '01J60000000000000000000000';
const SECOND_SKU_ID = '01J70000000000000000000000';
const QUOTE_ID = '01J80000000000000000000000';
const ORDER_ID = '01J90000000000000000000000';
const ORDER_ITEM_ID = '01JA0000000000000000000000';
const SECOND_ADDRESS_ID = '01JD0000000000000000000000';
const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const CONFIRMATION_HASH = 'c'.repeat(64);
const PHONE = ['100', '0000', '0000'].join('');
const LOGIN_CODE = 'mock:b9_ui_customer';

type CartStatus = 'SALEABLE' | 'INSUFFICIENT_STOCK' | 'OUT_OF_STOCK' | 'INACTIVE' | 'DELETED';

interface CartFact {
  quantity: number;
  sale_status: CartStatus;
  selected: boolean;
  sku_id: string;
}

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: Record<string, string>;
}

interface QuoteFailure {
  code: string;
  retryAfterSeconds?: number;
  status: 404 | 429 | 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function success(data: unknown) {
  return { code: 'OK', message: 'success', data, request_id: 'req_b9_ui' };
}

function failure(code: string, message: string) {
  return { code, message, request_id: 'req_b9_ui_error' };
}

async function fulfill(
  route: Route,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store, private', Pragma: 'no-cache', ...headers },
    status,
  });
}

class MockB9Backend {
  readonly calls: Call[] = [];
  readonly createdOrders = new Map<string, string>();
  readonly cancelledOrders = new Map<string, string>();
  readonly issuedQuoteTokens: string[] = [];
  cartItems: CartFact[] = [
    { quantity: 2, sale_status: 'SALEABLE', selected: true, sku_id: SKU_ID },
  ];
  quoteBlockers: Array<'CART_SELECTION_CHANGED' | 'ITEM_UNAVAILABLE' | 'INSUFFICIENT_STOCK'> = [];
  quoteDelayOnceMs = 0;
  quoteFailurePlan: QuoteFailure[] = [];
  quoteGeneration = 0;
  quoteLifetimeMs = 5 * 60 * 1_000;
  quoteUnauthorizedOnce = false;
  loseCreateResponseOnce = false;
  createDelayMs = 0;
  submitUnprocessableOnce = false;
  includeSecondAddress = false;
  cancelConflictOnce = false;
  loseCancelResponseOnce = false;
  orderClosed = false;
  orderVersion = 1;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  count(path: string, method?: string): number {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method)).length;
  }

  private addressSummary(addressId = ADDRESS_ID) {
    const second = addressId === SECOND_ADDRESS_ID;
    return {
      address_id: addressId,
      recipient_name_masked: second ? '林***' : '青***',
      phone_masked: second ? '100 **** 0001' : '100 **** 0000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail_masked: second ? '学院路 ****' : '文一路 ****',
      is_default: !second,
      version: 1,
    };
  }

  private cartView() {
    const items = this.cartItems.map((item) => ({
      sku_id: item.sku_id,
      product_id: PRODUCT_ID,
      product_name: 'B9 洗护套装',
      sku_name: item.sku_id === SECOND_SKU_ID ? '补充装' : '标准装',
      spec_json: {
        attributes: [{ name: '容量', value: item.sku_id === SECOND_SKU_ID ? '300ml' : '500ml' }],
      },
      primary_image_url: null,
      quantity: item.quantity,
      selected: item.selected,
      retail_price: item.sku_id === SECOND_SKU_ID ? '29.00' : '39.00',
      available_stock: item.sale_status === 'SALEABLE' ? 8 : 0,
      sale_status: item.sale_status,
    }));
    const amountInCents = items.reduce((total, item) => item.selected && item.sale_status === 'SALEABLE'
      ? total + Number(item.retail_price.replace('.', '')) * item.quantity
      : total, 0);
    return {
      cart_id: items.length > 0 ? CART_ID : null,
      items,
      total_amount: `${Math.floor(amountInCents / 100)}.${String(amountInCents % 100).padStart(2, '0')}`,
    };
  }

  private productView() {
    return {
      product_id: PRODUCT_ID,
      spu_code: 'B9-SPU',
      name: 'B9 洗护套装',
      subtitle: '订单与库存预占验收商品',
      introduction: '用于 B9.4 界面验收。',
      ingredients: null,
      usage_method: null,
      brand: { brand_id: BRAND_ID, name: '青序', description: null, logo_url: null, sort_order: 0 },
      category: { category_id: CATEGORY_ID, name: '洗护', icon_url: null, sort_order: 0 },
      images: [],
      skus: [
        {
          sku_id: SKU_ID,
          code: 'B9-SKU',
          name: '标准装',
          spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
          retail_price: '39.00',
          is_recommended: true,
          available_stock: 8,
          is_salable: true,
        },
      ],
      net_sales_count: 9,
      is_hot: true,
      is_new: false,
    };
  }

  private quoteView(input: Record<string, unknown>) {
    this.quoteGeneration += 1;
    const quoteToken = `quote-token-generation-${this.quoteGeneration}-at-least-twenty-characters`;
    this.issuedQuoteTokens.push(quoteToken);
    const lines = (input.items as Array<{ quantity: number; sku_id: string }>).map((item) => {
      const second = item.sku_id === SECOND_SKU_ID;
      const unit = second ? 2_900 : 3_900;
      const cartFact = this.cartItems.find(({ sku_id }) => sku_id === item.sku_id);
      const saleable = cartFact?.sale_status !== 'INACTIVE' && cartFact?.sale_status !== 'DELETED' &&
        cartFact?.sale_status !== 'OUT_OF_STOCK';
      return {
        product_id: PRODUCT_ID,
        product_name: 'B9 洗护套装',
        sku_id: item.sku_id,
        sku_name: second ? '补充装' : '标准装',
        spec_json: { attributes: [{ name: '容量', value: second ? '300ml' : '500ml' }] },
        primary_image_url: null,
        quantity: item.quantity,
        unit_price: `${Math.floor(unit / 100)}.00`,
        line_amount: `${Math.floor((unit * item.quantity) / 100)}.00`,
        available_stock: saleable ? 8 : 0,
        saleable,
      };
    });
    const goodsInCents = lines.reduce((total, line) => {
      const unit = Number(line.unit_price.replace('.', ''));
      return total + unit * line.quantity;
    }, 0);
    const canSubmit = this.quoteBlockers.length === 0;
    const amount = `${Math.floor(goodsInCents / 100)}.${String(goodsInCents % 100).padStart(2, '0')}`;
    return {
      quote_id: QUOTE_ID,
      source: input.source,
      address: this.addressSummary(String(input.address_id)),
      items: lines,
      goods_amount: amount,
      shipping_amount: '0.00',
      payable_amount: amount,
      can_submit: canSubmit,
      blockers: [...this.quoteBlockers],
      quote_token: canSubmit ? quoteToken : null,
      confirmation_hash: canSubmit ? CONFIRMATION_HASH : null,
      expires_at: canSubmit
        ? new Date(Date.parse('2099-08-29T01:00:00.000Z') + this.quoteLifetimeMs).toISOString()
        : null,
      server_time: '2099-08-29T01:00:00.000Z',
    };
  }

  private commandOrder(closed = this.orderClosed) {
    return {
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: closed ? 'CLOSED' : 'PENDING_PAYMENT',
      payment_status: 'UNPAID',
      refund_progress_status: 'NONE',
      refund_processing_status: 'IDLE',
      fulfillment_status: 'NOT_STARTED',
      close_reason: closed ? 'USER_CANCELLED' : null,
      completion_reason: null,
      payment_resolution: 'NORMAL',
      display_status: closed ? '已关闭' : '待付款',
      pay_expires_at: '2099-08-29T01:30:00.000Z',
      server_time: '2099-08-29T01:00:00.000Z',
      amounts: {
        goods: '78.00', shipping: '0.00', payable: '78.00', paid: '0.00', refunded: '0.00',
      },
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'B9 洗护套装',
        sku_name: '标准装',
        unit_price: '39.00',
        quantity: 2,
        line_amount: '78.00',
        refunded_quantity: 0,
        reserved_aftersale_quantity: 0,
        shipped_quantity: 0,
      }],
    };
  }

  private listOrder(closed: boolean) {
    const order = this.commandOrder(closed);
    return {
      order_id: order.order_id,
      order_no: order.order_no,
      order_status: order.order_status,
      payment_status: order.payment_status,
      refund_progress_status: order.refund_progress_status,
      refund_processing_status: order.refund_processing_status,
      fulfillment_status: order.fulfillment_status,
      close_reason: order.close_reason,
      completion_reason: order.completion_reason,
      payment_resolution: order.payment_resolution,
      display_status: order.display_status,
      payable_amount: order.amounts.payable,
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'B9 洗护套装',
        sku_name: '标准装',
        primary_image_url: null,
        quantity: 2,
        line_amount: '78.00',
      }],
      pay_expires_at: order.pay_expires_at,
      available_actions: closed ? [] : ['CANCEL'],
      aftersale_summary: {
        active_count: 0, latest_aftersale_id: null, latest_status: null, refunded_amount: '0.00',
      },
      created_at: '2099-08-29T01:00:00.000Z',
    };
  }

  private detailOrder() {
    return {
      ...this.commandOrder(),
      shipping_address: {
        recipient_name: '青序用户',
        phone: PHONE,
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        detail: '文一路 1 号',
      },
      available_actions: this.orderClosed ? [] : ['CANCEL'],
      timeline: [{
        event_id: this.orderClosed ? 'order-cancelled' : 'order-created',
        axis: 'ORDER',
        event: this.orderClosed ? 'USER_CANCELLED' : 'ORDER_CREATED',
        from_status: this.orderClosed ? 'PENDING_PAYMENT' : null,
        to_status: this.orderClosed ? 'CLOSED' : 'PENDING_PAYMENT',
        occurred_at: '2099-08-29T01:00:00.000Z',
      }],
      packages: [],
      aftersales: [],
      payment_attempts: [],
      refund_attempts: [],
      errors: [],
      version: this.orderVersion,
    };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    const call = {
      body,
      headers: request.headers(),
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    };
    this.calls.push(call);

    if (url.pathname === '/api/v1/store/legal-documents' && method === 'GET') {
      await fulfill(route, 200, success({
        user_agreement: { type: 'USER_AGREEMENT', document_version: 'b9-user', title: '用户协议', content_url: 'https://example.invalid/user', required: true },
        privacy_policy: { type: 'PRIVACY_POLICY', document_version: 'b9-privacy', title: '隐私政策', content_url: 'https://example.invalid/privacy', required: true },
        phone_authorization: { type: 'PHONE_AUTHORIZATION', document_version: 'b9-phone', title: '手机号授权说明', content_url: 'https://example.invalid/phone', required: true },
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/wechat/login' && method === 'POST') {
      await fulfill(route, 200, success({
        session: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          role: 'CUSTOMER',
          assurance: 'WECHAT',
          access_expires_at: '2099-08-29T12:00:00.000Z',
          refresh_expires_at: '2099-09-05T12:00:00.000Z',
        },
        confirmation_required: false,
        candidate: null,
      }));
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
      await fulfill(route, 200, success(this.productView()));
      return;
    }
    if (url.pathname === `/api/v1/store/favorites/${PRODUCT_ID}` && method === 'GET') {
      await fulfill(route, 200, success({ product_id: PRODUCT_ID, is_favorite: false }));
      return;
    }
    if (url.pathname === '/api/v1/store/cart' && method === 'GET') {
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    if (url.pathname === '/api/v1/store/addresses' && method === 'GET') {
      await fulfill(route, 200, success(this.includeSecondAddress
        ? [this.addressSummary(), this.addressSummary(SECOND_ADDRESS_ID)]
        : [this.addressSummary()]));
      return;
    }
    if (url.pathname === '/api/v1/store/checkout/quotes' && method === 'POST' && body !== null) {
      const plannedFailure = this.quoteFailurePlan.shift();
      if (plannedFailure !== undefined) {
        await fulfill(
          route,
          plannedFailure.status,
          failure(plannedFailure.code, 'planned quote failure'),
          plannedFailure.retryAfterSeconds === undefined
            ? {}
            : { 'Retry-After': String(plannedFailure.retryAfterSeconds) },
        );
        return;
      }
      if (this.quoteUnauthorizedOnce) {
        this.quoteUnauthorizedOnce = false;
        await fulfill(route, 401, failure('AUTH_REQUIRED', 'session expired'));
        return;
      }
      if (this.quoteDelayOnceMs > 0) {
        const wait = this.quoteDelayOnceMs;
        this.quoteDelayOnceMs = 0;
        await delay(wait);
      }
      await fulfill(route, 200, success(this.quoteView(body)));
      return;
    }
    if (url.pathname === '/api/v1/store/orders' && method === 'POST' && body !== null) {
      if (this.createDelayMs > 0) await delay(this.createDelayMs);
      if (this.submitUnprocessableOnce) {
        this.submitUnprocessableOnce = false;
        await fulfill(route, 422, failure('INSUFFICIENT_STOCK', 'stock changed'));
        return;
      }
      const key = request.headers()['idempotency-key'] ?? '';
      const serialized = JSON.stringify(body);
      const existing = this.createdOrders.get(key);
      if (existing !== undefined && existing !== serialized) {
        await fulfill(route, 409, failure('IDEMPOTENCY_KEY_REUSED', 'request changed'));
        return;
      }
      if (existing === undefined) this.createdOrders.set(key, serialized);
      if (this.loseCreateResponseOnce) {
        this.loseCreateResponseOnce = false;
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 201, success(this.commandOrder(false)));
      return;
    }
    if (url.pathname === '/api/v1/store/orders' && method === 'GET') {
      const closed = url.searchParams.get('order_status') === 'CLOSED';
      await fulfill(route, 200, success({
        items: [this.listOrder(closed)],
        pagination: { page: 1, page_size: 20, total: 1 },
      }));
      return;
    }
    if (url.pathname === `/api/v1/store/orders/${ORDER_ID}` && method === 'GET') {
      await fulfill(route, 200, success(this.detailOrder()));
      return;
    }
    if (url.pathname === `/api/v1/store/orders/${ORDER_ID}/cancel` && method === 'POST') {
      if (this.cancelConflictOnce) {
        this.cancelConflictOnce = false;
        this.orderVersion = 2;
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'order changed'));
        return;
      }
      const key = request.headers()['idempotency-key'] ?? '';
      const fingerprint = `${request.headers()['if-match'] ?? ''}:${request.postData() ?? ''}`;
      const existing = this.cancelledOrders.get(key);
      if (existing !== undefined && existing !== fingerprint) {
        await fulfill(route, 409, failure('IDEMPOTENCY_KEY_REUSED', 'request changed'));
        return;
      }
      if (existing === undefined) {
        this.cancelledOrders.set(key, fingerprint);
        this.orderClosed = true;
        this.orderVersion += 1;
      }
      if (this.loseCancelResponseOnce) {
        this.loseCancelResponseOnce = false;
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 200, success(this.commandOrder(true)));
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

async function confirmModal(page: Page, label: string): Promise<void> {
  await page.getByText(label, { exact: true }).last().click();
}

async function openReadyCheckout(page: Page): Promise<void> {
  await navigate(page, '/pages/checkout/index?source=CART');
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  await expect(uniButton(page, '提交待付款订单')).toBeEnabled();
}

function orderCalls(backend: MockB9Backend, method: string): Call[] {
  return backend.calls.filter(({ method: current, path }) =>
    current === method && path.startsWith('/api/v1/store/orders'));
}

test('B9.4 checkout, order detail and order tabs fit every acceptance viewport', async ({ page }, testInfo) => {
  const backend = new MockB9Backend();
  await backend.install(page);
  await login(page);
  await openReadyCheckout(page);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('checkout-ready.png') });
  await uniButton(page, '提交待付款订单').click();
  await confirmModal(page, '确认下单');
  await expect(page).toHaveURL(new RegExp(`/pages/orders/detail\\?order_id=${ORDER_ID}$`));
  await expect(page.getByText(`QX${ORDER_ID}`, { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('order-detail.png') });

  await navigate(page, '/pages/orders/index');
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: '已关闭' }).click();
  await expect(page.getByText('用户已取消', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('orders-closed.png') });

  const forbiddenButtons = page.locator('uni-button').filter({ hasText: /支付|物流|售后|确认收货/ });
  await expect(forbiddenButtons).toHaveCount(0);
  expect(backend.calls.some(({ path }) => /payment|refund|shipment|aftersale/.test(path))).toBe(false);
});

test('B9.4 sends every selected CART item to a normal blocked quote response', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The quote input matrix runs once.');
  const backend = new MockB9Backend();
  backend.cartItems = [
    { quantity: 2, sale_status: 'SALEABLE', selected: true, sku_id: SKU_ID },
    { quantity: 3, sale_status: 'INACTIVE', selected: true, sku_id: SECOND_SKU_ID },
    { quantity: 1, sale_status: 'SALEABLE', selected: false, sku_id: '01JC0000000000000000000000' },
  ];
  backend.quoteBlockers = ['ITEM_UNAVAILABLE'];
  await backend.install(page);
  await login(page);
  await navigate(page, '/pages/checkout/index?source=CART');

  await expect(page.getByText('部分商品或规格已失效，请调整后重新报价。', { exact: true })).toBeVisible();
  await expect(page.getByText('请先处理阻断项', { exact: true })).toBeVisible();
  await expect(uniButton(page, '提交待付款订单')).toHaveAttribute('disabled', 'true');
  const quoteCall = backend.calls.find(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/checkout/quotes');
  expect(quoteCall?.body).toEqual({
    source: 'CART',
    address_id: ADDRESS_ID,
    items: [
      { sku_id: SKU_ID, quantity: 2 },
      { sku_id: SECOND_SKU_ID, quantity: 3 },
    ],
  });
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 resumes one BUY_NOW SKU and quantity after login without submitting an order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The protected BUY_NOW flow runs once.');
  const backend = new MockB9Backend();
  await backend.install(page);
  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();

  await page.locator('uni-button.detail-choice__row').first().click();
  await page.locator('.sku-stepper').getByLabel('增加数量').click();
  await uniButton(page, '确认规格').click();
  await uniButton(page, '立即购买').click();
  await confirmModal(page, '去登录');
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(new RegExp(
    `/pages/checkout/index\\?source=BUY_NOW&product_id=${PRODUCT_ID}&sku_id=${SKU_ID}&quantity=2$`,
  ));
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  const quoteCall = backend.calls.find(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/checkout/quotes');
  expect(quoteCall?.body).toEqual({
    source: 'BUY_NOW',
    address_id: ADDRESS_ID,
    items: [{ sku_id: SKU_ID, quantity: 2 }],
  });
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 replaces an unauthorized checkout before login so return cannot revive its quote', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The checkout history regression runs once.');
  const backend = new MockB9Backend();
  backend.quoteUnauthorizedOnce = true;
  await backend.install(page);
  await login(page);

  await navigate(page, '/pages/checkout/index?source=CART');
  await expect(page).toHaveURL(/\/pages\/auth\/login$/);
  expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(1);
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();

  await expect(page).toHaveURL(/\/pages\/checkout\/index\?source=CART$/);
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(2);
  await uniButton(page, '提交待付款订单').click();
  await confirmModal(page, '确认下单');
  await expect(page).toHaveURL(new RegExp(`/pages/orders/detail\\?order_id=${ORDER_ID}$`));

  await page.getByLabel('返回').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index$/);
  await delay(150);
  expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(2);
  await expect(page).not.toHaveURL(/\/pages\/checkout\/index/);

  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`);
  await expect(page.getByText(`QX${ORDER_ID}`, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/pages\/profile\/index$/);
  await delay(150);
  expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(2);
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 renders the quote 404, 429, 500 and slow-request state matrix', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The quote state matrix runs once.');
  const backend = new MockB9Backend();
  await backend.install(page);
  await login(page);

  const failures: ReadonlyArray<{
    failure: QuoteFailure;
    assertState: () => Promise<void>;
  }> = [
    {
      failure: { code: 'RESOURCE_NOT_FOUND', status: 404 },
      assertState: async () => {
        await expect(page.getByText('没有可结算内容', { exact: true })).toBeVisible();
        await expect(page.getByText(/地址或商品已发生变化/, { exact: false })).toBeVisible();
      },
    },
    {
      failure: { code: 'RATE_LIMITED', retryAfterSeconds: 5, status: 429 },
      assertState: async () => {
        await expect(page.getByText('订单信息加载失败', { exact: true })).toBeVisible();
        await expect(page.locator('uni-button').filter({ hasText: /秒后可重试/ }))
          .toHaveAttribute('disabled', 'true');
      },
    },
    {
      failure: { code: 'INTERNAL_ERROR', status: 500 },
      assertState: async () => {
        await expect(page.getByText('订单信息加载失败', { exact: true })).toBeVisible();
        await expect(uniButton(page, '重新加载')).toBeVisible();
      },
    },
  ];

  for (const [index, scenario] of failures.entries()) {
    backend.quoteFailurePlan.push(scenario.failure);
    await navigate(page, '/pages/checkout/index?source=CART', 'reLaunch');
    await scenario.assertState();
    expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(index + 1);
    await expectNoHorizontalOverflow(page);
  }

  backend.quoteDelayOnceMs = 1_800;
  await navigate(page, '/pages/checkout/index?source=CART', 'reLaunch');
  await expect(page.getByText('网络响应较慢，仍在读取最新价格和库存。', { exact: true })).toBeVisible();
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(4);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 requotes after address change, submit 422 and quote expiry without reusing capability', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The checkout capability matrix runs once.');
  const backend = new MockB9Backend();
  backend.includeSecondAddress = true;
  await backend.install(page);
  await login(page);
  await openReadyCheckout(page);

  const secondAddress = page.locator('uni-button.checkout-address').filter({ hasText: '林***' });
  await secondAddress.click();
  await expect.poll(() => backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(2);
  await expect(secondAddress).toHaveAttribute('aria-pressed', 'true');
  const quoteCallsAfterAddressChange = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/checkout/quotes');
  expect(quoteCallsAfterAddressChange.map(({ body }) => body?.address_id)).toEqual([
    ADDRESS_ID,
    SECOND_ADDRESS_ID,
  ]);
  expect(backend.issuedQuoteTokens[0]).not.toBe(backend.issuedQuoteTokens[1]);

  backend.submitUnprocessableOnce = true;
  backend.quoteLifetimeMs = 2_500;
  await uniButton(page, '提交待付款订单').click();
  await confirmModal(page, '确认下单');
  await expect.poll(() => backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(3);
  await expect(page.getByText('订单条件不再满足，请重新报价后确认。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('qingxu:order-submit:v1'))).toBeNull();
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);

  await expect(page.getByText('报价已过期，请重新获取报价后再次确认。', { exact: true })).toBeVisible();
  await expect(uniButton(page, '重新报价后提交')).toBeVisible();
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);
  backend.quoteLifetimeMs = 5 * 60 * 1_000;
  await uniButton(page, '重新报价后提交').click();
  await expect.poll(() => backend.count('/api/v1/store/checkout/quotes', 'POST')).toBe(4);
  await expect(page.getByText('已重新读取最新订单信息，请再次确认。', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);

  await uniButton(page, '提交待付款订单').click();
  await confirmModal(page, '确认下单');
  await expect(page).toHaveURL(new RegExp(`/pages/orders/detail\\?order_id=${ORDER_ID}$`));
  const submitCalls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/orders');
  expect(submitCalls).toHaveLength(2);
  expect(submitCalls[0]?.headers['idempotency-key']).not.toBe(submitCalls[1]?.headers['idempotency-key']);
  expect(submitCalls[0]?.body?.quote_token).toBe(backend.issuedQuoteTokens[1]);
  expect(submitCalls[1]?.body?.quote_token).toBe(backend.issuedQuoteTokens[3]);
  expect(submitCalls[1]?.body?.address_id).toBe(SECOND_ADDRESS_ID);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 serializes submit clicks and retries a lost response with the exact journal command', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The ambiguous submit flow runs once.');
  const backend = new MockB9Backend();
  backend.createDelayMs = 150;
  backend.loseCreateResponseOnce = true;
  await backend.install(page);
  await login(page);
  await openReadyCheckout(page);

  await uniButton(page, '提交待付款订单').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await confirmModal(page, '确认下单');
  await expect(page.getByText(/提交结果暂时无法确认/, { exact: false })).toBeVisible();
  expect(backend.count('/api/v1/store/orders', 'POST')).toBe(1);
  await uniButton(page, '使用原请求继续确认').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(new RegExp(`/pages/orders/detail\\?order_id=${ORDER_ID}$`));

  const calls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/orders');
  expect(calls).toHaveLength(2);
  expect(calls[0]?.headers['idempotency-key']).toBe(calls[1]?.headers['idempotency-key']);
  expect(calls[0]?.body).toEqual(calls[1]?.body);
  expect(backend.createdOrders.size).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('B9.4 issues exact list filters and safely retries cancel after 409 and response loss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The order mutation matrix runs once.');
  const backend = new MockB9Backend();
  backend.cancelConflictOnce = true;
  backend.loseCancelResponseOnce = true;
  await backend.install(page);
  await login(page);

  await navigate(page, '/pages/orders/index');
  await expect(page.getByText('B9 洗护套装', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '待付款' }).click();
  await expect(page.getByText('可取消', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '已关闭' }).click();
  await expect(page.getByText('用户已取消', { exact: true })).toBeVisible();
  const listCalls = backend.calls.filter(({ method, path }) =>
    method === 'GET' && path === '/api/v1/store/orders');
  expect(listCalls.map(({ query }) => query)).toEqual([
    { display_group: 'ALL', page: '1', page_size: '20' },
    { display_group: 'PENDING_PAYMENT', page: '1', page_size: '20' },
    { order_status: 'CLOSED', page: '1', page_size: '20' },
  ]);

  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`);
  await expect(uniButton(page, '取消订单')).toBeEnabled();
  await uniButton(page, '取消订单').click();
  await confirmModal(page, '确认取消');
  await expect(page.getByText(/版本已变化，已刷新详情/, { exact: false })).toBeVisible();

  await uniButton(page, '取消订单').click();
  await confirmModal(page, '确认取消');
  await expect(page.getByText(/取消结果暂时无法确认/, { exact: false })).toBeVisible();
  await uniButton(page, '取消订单').click();
  await confirmModal(page, '确认取消');
  await expect(page.getByText('订单已取消，服务端已确认关闭。', { exact: true })).toBeVisible();
  await expect(page.getByText('已关闭', { exact: true })).toBeVisible();

  const cancelCalls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === `/api/v1/store/orders/${ORDER_ID}/cancel`);
  expect(cancelCalls).toHaveLength(3);
  expect(cancelCalls.map(({ headers }) => headers['if-match'])).toEqual(['"1"', '"2"', '"2"']);
  expect(cancelCalls[0]?.headers['idempotency-key']).not.toBe(cancelCalls[1]?.headers['idempotency-key']);
  expect(cancelCalls[1]?.headers['idempotency-key']).toBe(cancelCalls[2]?.headers['idempotency-key']);
  expect(cancelCalls.every(({ body }) => body === null)).toBe(true);
  expect(backend.cancelledOrders.size).toBe(1);
  expect(orderCalls(backend, 'POST').some(({ path }) => /payment|refund|shipment|aftersale/.test(path))).toBe(false);
  await expect(page.locator('uni-button').filter({ hasText: /支付|物流|售后|确认收货/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
