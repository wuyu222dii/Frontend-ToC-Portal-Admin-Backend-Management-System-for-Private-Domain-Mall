import { expect, test, type Page, type Route } from '@playwright/test';

const CUSTOMER_ID = '01J20000000000000000000000';
const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const ORDER_ID = '01J90000000000000000000000';
const ORDER_ITEM_ID = '01JA0000000000000000000000';
const SHIPMENT_ID = '01JB0000000000000000000000';
const EVENT_ID = '01JC0000000000000000000000';
const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const PHONE = ['100', '0000', '0000'].join('');
const RAW_ADDRESS = ['B11', ' development ', 'address'].join('');
const LOGIN_CODE = 'mock:b11_fulfillment_customer';

interface RecordedCall {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  path: string;
}

type FailureStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500;
type ConfirmStep =
  | { kind: 'ABORT' }
  | { code: string; kind: 'FAILURE'; status: FailureStatus; retryAfterSeconds?: number; bumpVersion?: boolean }
  | { delayMs?: number; kind: 'SUCCESS' };

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b11_miniapp' };
}

function failure(code: string, message = 'request rejected') {
  return { code, message, request_id: 'req_b11_miniapp_error' };
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

class MockMiniappFulfillmentBackend {
  readonly calls: RecordedCall[] = [];
  readonly confirmSteps: ConfirmStep[] = [];
  readonly confirmedKeys = new Set<string>();
  completed = false;
  detailGateOnce: Promise<void> | null = null;
  logisticsDelayOnceMs = 0;
  nextDetailFailure: { code: string; status: FailureStatus; retryAfterSeconds?: number } | null = null;
  nextLogisticsFailure: { code: string; status: FailureStatus; retryAfterSeconds?: number } | null = null;
  orderVersion = 4;
  packageVersion = 2;
  shipmentAvailable = true;
  suppressActions = false;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  count(path: string, method?: string): number {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method)).length;
  }

  holdNextDetail(): () => void {
    let release: () => void = () => undefined;
    this.detailGateOnce = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  private event() {
    return {
      event_id: EVENT_ID,
      event_key: 'b11-in-transit',
      event_type: 'STATUS',
      status_code: 'IN_TRANSIT',
      carrier_code: null,
      carrier_name: null,
      tracking_no: null,
      description: '包裹已进入运输环节',
      reason: null,
      location: 'Development sorting centre',
      occurred_at: '2099-08-31T02:10:00.000Z',
    };
  }

  private shipment() {
    if (!this.shipmentAvailable) return null;
    return {
      shipment_id: SHIPMENT_ID,
      order_id: ORDER_ID,
      status: this.completed ? 'DELIVERED' : 'IN_TRANSIT',
      carrier_code: 'DEV',
      carrier_name: 'B11 Development Carrier',
      tracking_no: 'B11-TRACK-001',
      shipped_at: '2099-08-31T02:00:00.000Z',
      delivered_at: this.completed ? '2099-08-31T03:00:00.000Z' : null,
      items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
      version: this.packageVersion,
    };
  }

  private orderPackage() {
    const shipment = this.shipment();
    if (shipment === null) return null;
    return {
      shipment_id: shipment.shipment_id,
      carrier_name: shipment.carrier_name,
      tracking_no: shipment.tracking_no,
      status: shipment.status,
      items: [{
        order_item_id: ORDER_ITEM_ID,
        sku_id: SKU_ID,
        product_name: 'B11 洗护套装',
        sku_name: '标准装',
        quantity: 2,
      }],
      events: [this.event()],
      shipped_at: shipment.shipped_at,
      delivered_at: shipment.delivered_at,
      version: shipment.version,
    };
  }

  private detail() {
    const currentPackage = this.orderPackage();
    return {
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: this.completed ? 'COMPLETED' : 'SHIPPING',
      payment_status: 'PAID',
      refund_progress_status: 'NONE',
      refund_processing_status: 'IDLE',
      fulfillment_status: this.completed ? 'DELIVERED' : 'IN_TRANSIT',
      close_reason: null,
      completion_reason: this.completed ? 'CUSTOMER_CONFIRMED' : null,
      payment_resolution: 'NORMAL',
      display_status: this.completed ? '已完成' : '运输中',
      pay_expires_at: '2099-08-31T01:30:00.000Z',
      server_time: '2099-08-31T01:00:00.000Z',
      amounts: { goods: '78.00', shipping: '0.00', payable: '78.00', paid: '78.00', refunded: '0.00' },
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'B11 洗护套装',
        sku_name: '标准装',
        unit_price: '39.00',
        quantity: 2,
        line_amount: '78.00',
        refunded_quantity: 0,
        reserved_aftersale_quantity: 0,
        shipped_quantity: 2,
      }],
      shipping_address: {
        recipient_name: 'Development Recipient',
        phone: PHONE,
        province: 'Development Province',
        city: 'Development City',
        district: 'Development District',
        detail: RAW_ADDRESS,
      },
      available_actions: this.suppressActions
        ? []
        : this.completed ? ['VIEW_LOGISTICS'] : ['VIEW_LOGISTICS', 'CONFIRM_RECEIPT'],
      timeline: [{
        event_id: 'b11-order-created',
        axis: 'ORDER',
        event: this.completed ? 'ORDER_COMPLETED' : 'SHIPMENT_IN_TRANSIT',
        from_status: this.completed ? 'SHIPPING' : 'SHIPPED',
        to_status: this.completed ? 'COMPLETED' : 'IN_TRANSIT',
        occurred_at: this.completed ? '2099-08-31T03:00:00.000Z' : '2099-08-31T02:10:00.000Z',
      }],
      packages: currentPackage === null ? [] : [currentPackage],
      aftersales: [],
      payment_attempts: [],
      refund_attempts: [],
      errors: [],
      version: this.orderVersion,
    };
  }

  private record(route: Route): RecordedCall {
    const request = route.request();
    const call = {
      body: request.postData() ? request.postDataJSON() : null,
      headers: request.headers(),
      method: request.method(),
      path: new URL(request.url()).pathname,
    };
    this.calls.push(call);
    return call;
  }

  private async plannedFailure(
    route: Route,
    current: { code: string; status: FailureStatus; retryAfterSeconds?: number },
  ): Promise<void> {
    await fulfill(
      route,
      current.status,
      failure(current.code),
      current.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(current.retryAfterSeconds) },
    );
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);
    const request = route.request();

    if (call.path === '/api/v1/store/legal-documents' && call.method === 'GET') {
      await fulfill(route, 200, success({
        user_agreement: { type: 'USER_AGREEMENT', document_version: 'b11-user', title: '用户协议', content_url: 'https://example.invalid/user', required: true },
        privacy_policy: { type: 'PRIVACY_POLICY', document_version: 'b11-privacy', title: '隐私政策', content_url: 'https://example.invalid/privacy', required: true },
        phone_authorization: { type: 'PHONE_AUTHORIZATION', document_version: 'b11-phone', title: '手机号授权说明', content_url: 'https://example.invalid/phone', required: true },
      }));
      return;
    }
    if (call.path === '/api/v1/store/auth/wechat/login' && call.method === 'POST') {
      await fulfill(route, 200, success({
        session: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          role: 'CUSTOMER',
          assurance: 'WECHAT',
          access_expires_at: '2099-08-31T12:00:00.000Z',
          refresh_expires_at: '2099-09-07T12:00:00.000Z',
        },
        confirmation_required: false,
        candidate: null,
      }));
      return;
    }
    if (call.path === '/api/v1/store/auth/refresh' && call.method === 'POST') {
      await fulfill(route, 401, failure('AUTH_REQUIRED'));
      return;
    }
    if (call.path === '/api/v1/store/profile' && call.method === 'GET') {
      await fulfill(route, 200, success({
        customer_id: CUSTOMER_ID,
        nickname: 'B11 Customer',
        avatar_url: null,
        city: null,
        phone_tail: null,
        phone_masked: null,
        phone_source: null,
        phone_verified_at: null,
        version: 1,
      }));
      return;
    }
    if (call.path === '/api/v1/store/service-agent' && call.method === 'GET') {
      await fulfill(route, 200, success(null));
      return;
    }

    expect(request.headers().authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    if (call.path === `/api/v1/store/orders/${ORDER_ID}` && call.method === 'GET') {
      if (this.detailGateOnce !== null) {
        const gate = this.detailGateOnce;
        this.detailGateOnce = null;
        await gate;
      }
      if (this.nextDetailFailure !== null) {
        const current = this.nextDetailFailure;
        this.nextDetailFailure = null;
        await this.plannedFailure(route, current);
        return;
      }
      await fulfill(route, 200, success(this.detail()));
      return;
    }
    if (call.path === `/api/v1/store/orders/${ORDER_ID}/logistics` && call.method === 'GET') {
      if (this.logisticsDelayOnceMs > 0) {
        const delayMs = this.logisticsDelayOnceMs;
        this.logisticsDelayOnceMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (this.nextLogisticsFailure !== null) {
        const current = this.nextLogisticsFailure;
        this.nextLogisticsFailure = null;
        await this.plannedFailure(route, current);
        return;
      }
      const shipment = this.shipment();
      await fulfill(route, 200, success({ shipment, events: shipment === null ? [] : [this.event()] }));
      return;
    }
    if (call.path === `/api/v1/store/orders/${ORDER_ID}/confirm-receipt` && call.method === 'POST') {
      expect(call.body).toBeNull();
      const idempotencyKey = call.headers['idempotency-key'];
      expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      if (this.confirmedKeys.has(idempotencyKey)) {
        await fulfill(route, 200, success(this.detail()));
        return;
      }
      const step = this.confirmSteps.shift() ?? { kind: 'SUCCESS' };
      if (step.kind === 'ABORT') {
        this.completed = true;
        this.orderVersion += 1;
        this.packageVersion += 1;
        this.confirmedKeys.add(idempotencyKey);
        await route.abort('connectionreset');
        return;
      }
      if (step.kind === 'FAILURE') {
        if (step.bumpVersion) this.orderVersion += 1;
        await this.plannedFailure(route, step);
        return;
      }
      if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      this.completed = true;
      this.orderVersion += 1;
      this.packageVersion += 1;
      this.confirmedKeys.add(idempotencyKey);
      await fulfill(route, 200, success(this.detail()));
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE', `${call.method} ${call.path}`));
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
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function expectNoPersistedPii(page: Page): Promise<void> {
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(storage).not.toContain(PHONE);
  expect(storage).not.toContain(RAW_ADDRESS);
  expect(storage).not.toContain('Development Recipient');
}

function isStateMatrixProject(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

async function openOrderDetail(page: Page): Promise<void> {
  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`);
  await expect(page.getByTestId('order-detail-state-ready')).toBeVisible();
}

async function submitReceipt(page: Page, duplicate = false): Promise<void> {
  await page.getByTestId('confirm-receipt-button').click();
  await expect(page.getByTestId('confirm-receipt-dialog')).toBeVisible();
  const submit = page.getByTestId('confirm-receipt-dialog-submit');
  if (duplicate) {
    await submit.evaluate((element: HTMLElement) => {
      element.click();
      element.click();
    });
  } else {
    await submit.click();
  }
}

test('MP-10/11/12 renders fulfillment and confirms receipt at every acceptance viewport', async ({ page }) => {
  const backend = new MockMiniappFulfillmentBackend();
  await backend.install(page);
  await login(page);
  await openOrderDetail(page);

  await expect(page.getByTestId('order-logistics-section')).toContainText('B11 Development Carrier');
  await expect(page.getByTestId('order-logistics-section')).toContainText('B11-TRACK-001');
  await expect(page.getByTestId('confirm-receipt-button')).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await expectNoPersistedPii(page);

  await page.getByTestId('order-logistics-open').click();
  await expect(page).toHaveURL(new RegExp(`/pages/orders/logistics\\?order_id=${ORDER_ID}$`));
  await expect(page.getByTestId('logistics-state-ready')).toBeVisible();
  await expect(page.getByTestId('logistics-timeline')).toContainText('包裹已进入运输环节');
  await expect(page.getByTestId(`logistics-event-${EVENT_ID}`)).toBeVisible();
  await expect(page.getByTestId(`logistics-item-${ORDER_ITEM_ID}`)).toContainText('B11 洗护套装');
  await expect(page.getByTestId(`logistics-item-${ORDER_ITEM_ID}`)).toContainText('标准装');
  await expect(page.getByTestId(`logistics-item-${ORDER_ITEM_ID}`)).toContainText('×2');
  await expectNoHorizontalOverflow(page);

  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`, 'reLaunch');
  await expect(page.getByTestId('order-detail-state-ready')).toBeVisible();

  await submitReceipt(page, true);
  await expect(page.getByText('已确认收货，订单状态已由服务端更新。', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
  expect(backend.count(`/api/v1/store/orders/${ORDER_ID}/confirm-receipt`, 'POST')).toBe(1);
  const confirmCall = backend.calls.find(({ method, path }) =>
    method === 'POST' && path.endsWith('/confirm-receipt'));
  expect(confirmCall?.headers['if-match']).toBe('"4"');
  await expectNoHorizontalOverflow(page);
  await expectNoPersistedPii(page);
});

test('MP-11 exposes logistics loading, empty and closed error states', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The logistics state matrix runs at 390 and 1024 widths.');
  const backend = new MockMiniappFulfillmentBackend();
  await backend.install(page);
  await login(page);

  backend.logisticsDelayOnceMs = 1_200;
  await navigate(page, `/pages/orders/logistics?order_id=${ORDER_ID}`);
  await expect(page.getByTestId('logistics-state-loading')).toBeVisible();
  await expect(page.getByTestId('logistics-state-ready')).toBeVisible();
  await expect(page.getByTestId('logistics-timeline')).toContainText('包裹已进入运输环节');
  await expectNoHorizontalOverflow(page);

  backend.shipmentAvailable = false;
  await page.getByTestId('logistics-refresh').click();
  await expect(page.getByTestId('logistics-state-empty')).toBeVisible();

  const scenarios = [
    { code: 'RESOURCE_NOT_FOUND', state: 'logistics-state-not-found', status: 404 as const },
    { code: 'RATE_LIMITED', retryAfterSeconds: 7, state: 'logistics-state-rate-limited', status: 429 as const },
    { code: 'INTERNAL_ERROR', state: 'logistics-state-error', status: 500 as const },
  ];
  backend.shipmentAvailable = true;
  for (const scenario of scenarios) {
    backend.nextLogisticsFailure = scenario;
    await navigate(page, `/pages/orders/logistics?order_id=${ORDER_ID}`, 'reLaunch');
    await expect(page.getByTestId(scenario.state)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('MP-12 refreshes 409/422/403 and safely retries 429 and a lost response', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The command fault matrix runs at 390 and 1024 widths.');
  const backend = new MockMiniappFulfillmentBackend();
  backend.confirmSteps.push(
    { bumpVersion: true, code: 'RESOURCE_VERSION_CONFLICT', kind: 'FAILURE', status: 409 },
    { code: 'ORDER_NOT_RECEIVABLE', kind: 'FAILURE', status: 422 },
    { code: 'FORBIDDEN', kind: 'FAILURE', status: 403 },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 9, status: 429 },
    { kind: 'ABORT' },
    { kind: 'SUCCESS' },
  );
  await backend.install(page);
  await login(page);
  await openOrderDetail(page);

  await submitReceipt(page);
  await expect(page.getByText(/订单状态已变化，已刷新/, { exact: false })).toBeVisible();
  await submitReceipt(page);
  await expect(page.getByText(/当前收货条件不再满足/, { exact: false })).toBeVisible();
  await submitReceipt(page);
  await expect(page.getByText(/当前收货条件不再满足/, { exact: false })).toBeVisible();
  await submitReceipt(page);
  await expect(page.getByText(/9 秒后使用当前确认收货操作重试/, { exact: false })).toBeVisible();
  await submitReceipt(page);
  await expect(page.getByText(/确认收货结果暂时无法确认/, { exact: false })).toBeVisible();
  await submitReceipt(page, true);
  await expect(page.getByText('已确认收货，订单状态已由服务端更新。', { exact: true })).toBeVisible();

  const calls = backend.calls.filter(({ method, path }) => method === 'POST' && path.endsWith('/confirm-receipt'));
  expect(calls).toHaveLength(6);
  expect(calls.map(({ headers }) => headers['if-match'])).toEqual(['"4"', '"5"', '"5"', '"5"', '"5"', '"5"']);
  expect(calls[0]?.headers['idempotency-key']).not.toBe(calls[1]?.headers['idempotency-key']);
  expect(calls[1]?.headers['idempotency-key']).not.toBe(calls[2]?.headers['idempotency-key']);
  expect(calls[2]?.headers['idempotency-key']).not.toBe(calls[3]?.headers['idempotency-key']);
  expect(calls[3]?.headers['idempotency-key']).toBe(calls[4]?.headers['idempotency-key']);
  expect(calls[4]?.headers['idempotency-key']).toBe(calls[5]?.headers['idempotency-key']);
  await expectNoHorizontalOverflow(page);
  await expectNoPersistedPii(page);
});

test('MP-10 keeps slow, 401, 404, 429, 500 and network failures closed', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The detail state matrix runs at 390 and 1024 widths.');
  const backend = new MockMiniappFulfillmentBackend();
  await backend.install(page);
  await login(page);

  const releaseDetail = backend.holdNextDetail();
  const navigation = navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`);
  await expect(page.getByTestId('order-detail-state-loading')).toBeVisible();
  try {
    await expect(page.getByText('网络响应较慢，仍在读取本人订单详情。', { exact: true })).toBeVisible();
  } finally {
    releaseDetail();
  }
  await navigation;
  await expect(page.getByTestId('order-detail-state-ready')).toBeVisible();

  for (const scenario of [
    { code: 'RESOURCE_NOT_FOUND', state: 'order-detail-state-not-found', status: 404 as const },
    { code: 'RATE_LIMITED', retryAfterSeconds: 5, state: 'order-detail-state-rate-limited', status: 429 as const },
    { code: 'INTERNAL_ERROR', state: 'order-detail-state-error', status: 500 as const },
  ]) {
    backend.nextDetailFailure = scenario;
    await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`, 'reLaunch');
    await expect(page.getByTestId(scenario.state)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  backend.nextDetailFailure = { code: 'AUTH_REQUIRED', status: 401 };
  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`, 'reLaunch');
  await expect(page).toHaveURL(/\/pages\/auth\/login$/);
});

test('MP-10 treats available_actions as authoritative even when a package is present', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The action-authority check runs at 390 and 1024 widths.');
  const backend = new MockMiniappFulfillmentBackend();
  backend.suppressActions = true;
  await backend.install(page);
  await login(page);
  await openOrderDetail(page);

  await expect(page.getByTestId('order-logistics-section')).toHaveCount(0);
  await expect(page.getByTestId('order-logistics-open')).toHaveCount(0);
  await expect(page.getByTestId('confirm-receipt-button')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test.skip('MP-11 clipboard permission denial leaves tracking data on-screen without claiming a copy', async () => {
  // Designed skip: browser clipboard permission behavior is covered by the vertical browser profile in B11.5.
});
