import { expect, test, type Page, type Route } from '@playwright/test';

const CUSTOMER_ID = '01J20000000000000000000000';
const PRODUCT_ID = '01J30000000000000000000000';
const SKU_ID = '01J40000000000000000000000';
const ORDER_ID = '01J50000000000000000000000';
const ORDER_ITEM_ID = '01J60000000000000000000000';
const ORDER_ITEM_ID_2 = '01J60000000000000000000001';
const AFTERSALE_ID = '01J70000000000000000000000';
const AFTERSALE_ITEM_ID = '01J80000000000000000000000';
const AFTERSALE_ITEM_ID_2 = '01J80000000000000000000001';
const EVENT_ID = '01J90000000000000000000000';
const INSPECTION_ID = '01JA0000000000000000000000';
const INSPECTION_FILE_ID = '01JB0000000000000000000000';
const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const LOGIN_CODE = 'mock:b12_aftersale_customer';

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
}

type Failure = { code: string; status: 401 | 403 | 404 | 409 | 422 | 429 | 500; retryAfter?: number };
type Step = Failure | { kind: 'ABORT' };

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b12_miniapp' };
}

function failure(code: string) {
  return { code, message: 'controlled test failure', request_id: 'req_b12_miniapp_error' };
}

async function fulfill(route: Route, status: number, payload: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store, private', Pragma: 'no-cache', ...headers },
    status,
  });
}

class MockMiniappAftersaleBackend {
  readonly calls: Call[] = [];
  readonly previewSteps: Step[] = [];
  readonly confirmSteps: Step[] = [];
  readonly commandSteps: Step[] = [];
  readonly confirmedKeys = new Set<string>();
  orderActions: string[] = ['APPLY_AFTERSALE'];
  detailActions: string[] = ['CANCEL', 'VIEW_ORDER'];
  nextOrderFailure: Failure | null = null;
  nextDetailFailure: Failure | null = null;
  orderDelayOnceMs = 0;
  reservedAftersaleQuantity = 0;
  detailItemAmounts = ['39.00'];
  inspectionEvidenceFileIds: string[] | null = null;
  aftersaleStatus = 'PENDING_REVIEW';
  aftersaleVersion = 1;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  callsFor(path: string, method?: string): Call[] {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method));
  }

  private record(route: Route): Call {
    const request = route.request();
    const call = {
      body: request.postData() ? request.postDataJSON() as Record<string, unknown> : null,
      headers: request.headers(),
      method: request.method(),
      path: new URL(request.url()).pathname,
    };
    this.calls.push(call);
    return call;
  }

  private async applyStep(route: Route, step: Step): Promise<boolean> {
    if ('kind' in step) {
      await route.abort('connectionreset');
      return true;
    }
    await fulfill(
      route,
      step.status,
      failure(step.code),
      step.retryAfter === undefined ? {} : { 'Retry-After': String(step.retryAfter) },
    );
    return true;
  }

  private orderDetail() {
    return {
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: 'COMPLETED',
      payment_status: 'PAID',
      refund_progress_status: 'NONE',
      refund_processing_status: 'IDLE',
      fulfillment_status: 'DELIVERED',
      close_reason: null,
      completion_reason: 'CUSTOMER_CONFIRMED',
      payment_resolution: 'NORMAL',
      display_status: '已完成',
      pay_expires_at: '2099-09-01T01:30:00.000Z',
      server_time: '2099-09-01T02:00:00.000Z',
      amounts: { goods: '39.00', shipping: '0.00', payable: '39.00', paid: '39.00', refunded: '0.00' },
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'B12 洗护套装',
        sku_name: '标准装',
        unit_price: '39.00',
        quantity: 1,
        line_amount: '39.00',
        refunded_quantity: 0,
        reserved_aftersale_quantity: this.reservedAftersaleQuantity,
        shipped_quantity: 1,
      }],
      shipping_address: {
        recipient_name: 'Development Recipient',
        phone: ['100', '0000', '0000'].join(''),
        province: 'Development Province',
        city: 'Development City',
        district: 'Development District',
        detail: 'Development address',
      },
      available_actions: this.orderActions,
      timeline: [{
        event_id: `${ORDER_ID}:timeline`,
        axis: 'ORDER',
        event: 'ORDER_COMPLETED',
        from_status: 'SHIPPING',
        to_status: 'COMPLETED',
        occurred_at: '2099-09-01T02:00:00.000Z',
      }],
      packages: [],
      aftersales: [],
      payment_attempts: [],
      refund_attempts: [],
      errors: [],
      version: 4,
    };
  }

  private preview() {
    return {
      can_submit: true,
      blockers: [],
      items: [{
        order_item_id: ORDER_ITEM_ID,
        requested_quantity: 1,
        remaining_refundable_quantity: 1,
        allocated_amount: '39.00',
        remaining_refundable_amount: '39.00',
      }],
      requested_amount: '39.00',
      preview_token: 'preview_token_b12_customer',
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2099-09-01T02:05:00.000Z',
    };
  }

  private command() {
    return {
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      type: 'REFUND_ONLY',
      status: this.aftersaleStatus,
      items: [{
        aftersale_item_id: AFTERSALE_ITEM_ID,
        order_item_id: ORDER_ITEM_ID,
        quantity: 1,
        allocated_amount: '39.00',
        approved_refund_qty: null,
      }],
      timeline: [{ event: 'AFTERSALE_CREATED', occurred_at: '2099-09-01T02:01:00.000Z' }],
    };
  }

  private aftersaleDetail() {
    return {
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      order: {
        order_id: ORDER_ID,
        order_no: `QX${ORDER_ID}`,
        display_status: '已完成',
        payable_amount: '39.00',
        paid_at: '2099-09-01T01:00:00.000Z',
      },
      type: 'REFUND_ONLY',
      status: this.aftersaleStatus,
      reason: '未发货，不再需要',
      items: this.detailItemAmounts.map((amount, index) => ({
        aftersale_item_id: index === 0 ? AFTERSALE_ITEM_ID : AFTERSALE_ITEM_ID_2,
        order_item_id: index === 0 ? ORDER_ITEM_ID : ORDER_ITEM_ID_2,
        product_name: `B12 洗护套装 ${index + 1}`,
        sku_name: '标准装',
        requested_quantity: 1,
        allocated_amount: amount,
        reserved_quantity: this.aftersaleStatus === 'CANCELLED' ? 0 : 1,
        reserved_amount: this.aftersaleStatus === 'CANCELLED' ? '0.00' : amount,
        approved_refund_quantity: null,
        refunded_quantity: 0,
      })),
      return_address: null,
      return_shipment: null,
      inspection: this.inspectionEvidenceFileIds === null ? null : {
        abnormal_reason: '外包装存在受控异常',
        evidence_file_ids: this.inspectionEvidenceFileIds,
        inspected_at: '2099-09-01T02:02:00.000Z',
        inspection_id: INSPECTION_ID,
        items: [{
          approved_refund_qty: 1,
          damaged_qty: 1,
          order_item_id: ORDER_ITEM_ID,
          received_qty: 1,
          restock_qty: 0,
          return_to_customer_qty: 0,
          scrap_qty: 0,
        }],
        resolution: null,
        resolution_reason: null,
        resolved_at: null,
        result: 'ABNORMAL',
      },
      refund_attempts: [],
      available_actions: this.aftersaleStatus === 'CANCELLED' ? ['VIEW_ORDER'] : this.detailActions,
      timeline: [{
        event_id: EVENT_ID,
        event: this.aftersaleStatus === 'CANCELLED' ? 'AFTERSALE_CANCELLED' : 'AFTERSALE_CREATED',
        from_status: null,
        to_status: this.aftersaleStatus,
        operator_role: 'CUSTOMER',
        occurred_at: '2099-09-01T02:01:00.000Z',
      }],
      errors: [],
      created_at: '2099-09-01T02:01:00.000Z',
      version: this.aftersaleVersion,
    };
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);

    if (call.path === '/api/v1/store/home' && call.method === 'GET') {
      await fulfill(route, 200, success({
        banners: [], categories: [], hot_products: [], new_products: [],
        section_status: { banners: 'READY', categories: 'READY', hot_products: 'READY', new_products: 'READY' },
      }));
      return;
    }
    if (call.path === '/api/v1/store/legal-documents' && call.method === 'GET') {
      await fulfill(route, 200, success({
        user_agreement: { type: 'USER_AGREEMENT', document_version: 'b12-user', title: '用户协议', content_url: 'https://example.invalid/user', required: true },
        privacy_policy: { type: 'PRIVACY_POLICY', document_version: 'b12-privacy', title: '隐私政策', content_url: 'https://example.invalid/privacy', required: true },
        phone_authorization: { type: 'PHONE_AUTHORIZATION', document_version: 'b12-phone', title: '手机号授权说明', content_url: 'https://example.invalid/phone', required: true },
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
          access_expires_at: '2099-09-01T12:00:00.000Z',
          refresh_expires_at: '2099-09-08T12:00:00.000Z',
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
        nickname: 'B12 Customer',
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

    expect(call.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    if (call.path === '/api/v1/store/auth/logout' && call.method === 'POST') {
      await fulfill(route, 200, success({
        resource_type: 'CUSTOMER_SESSION', resource_id: CUSTOMER_ID, status: 'REVOKED', version: 2,
        occurred_at: '2026-09-03T12:00:00.000Z',
      }));
      return;
    }
    if (call.path === `/api/v1/store/orders/${ORDER_ID}` && call.method === 'GET') {
      if (this.orderDelayOnceMs > 0) {
        const delay = this.orderDelayOnceMs;
        this.orderDelayOnceMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.nextOrderFailure) {
        const current = this.nextOrderFailure;
        this.nextOrderFailure = null;
        await this.applyStep(route, current);
        return;
      }
      await fulfill(route, 200, success(this.orderDetail()));
      return;
    }
    if (call.path === '/api/v1/store/aftersales' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      if (call.body?.action === 'PREVIEW') {
        const step = this.previewSteps.shift();
        if (step) {
          await this.applyStep(route, step);
          return;
        }
        await fulfill(route, 200, success(this.preview()));
        return;
      }
      const idempotencyKey = call.headers['idempotency-key'] ?? '';
      if (this.confirmedKeys.has(idempotencyKey)) {
        await fulfill(route, 201, success(this.command()));
        return;
      }
      const step = this.confirmSteps.shift();
      if (step && 'kind' in step) {
        this.confirmedKeys.add(idempotencyKey);
        await route.abort('connectionreset');
        return;
      }
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      this.confirmedKeys.add(idempotencyKey);
      await fulfill(route, 201, success(this.command()));
      return;
    }
    if (call.path === `/api/v1/store/aftersales/${AFTERSALE_ID}` && call.method === 'GET') {
      if (this.nextDetailFailure) {
        const current = this.nextDetailFailure;
        this.nextDetailFailure = null;
        await this.applyStep(route, current);
        return;
      }
      await fulfill(route, 200, success(this.aftersaleDetail()));
      return;
    }
    if (call.path === `/api/v1/store/aftersales/${AFTERSALE_ID}/cancel` && call.method === 'POST') {
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      const step = this.commandSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      this.aftersaleStatus = 'CANCELLED';
      this.aftersaleVersion += 1;
      await fulfill(route, 200, success(this.command()));
      return;
    }
    if (call.path === `/api/v1/store/aftersales/${AFTERSALE_ID}/return-shipment` && call.method === 'POST') {
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success(this.command()));
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE'));
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
  const dimensions = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

function stateMatrix(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

async function openApplication(page: Page): Promise<void> {
  await navigate(page, `/pages/aftersales/apply?order_id=${ORDER_ID}`);
  await expect(page.getByTestId('aftersale-apply-ready')).toBeVisible();
}

test('MP-13/14 previews, confirms and cancels an aftersale at every viewport', async ({ page }) => {
  const backend = new MockMiniappAftersaleBackend();
  await backend.install(page);
  await login(page);
  await openApplication(page);

  await page.getByLabel('增加数量').click();
  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByTestId('aftersale-preview')).toContainText('¥39.00');
  await page.getByTestId('aftersale-confirm-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(new RegExp(`/pages/aftersales/detail\\?aftersale_id=${AFTERSALE_ID}$`));
  await expect(page.getByTestId('aftersale-detail-ready')).toBeVisible();
  await expect(page.getByTestId('aftersale-cancel')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const createCalls = backend.callsFor('/api/v1/store/aftersales', 'POST');
  expect(createCalls).toHaveLength(2);
  expect(createCalls[0]?.body?.action).toBe('PREVIEW');
  expect(createCalls[1]?.body?.action).toBe('CONFIRM');
  expect(createCalls[0]?.headers['idempotency-key']).not.toBe(createCalls[1]?.headers['idempotency-key']);
  expect(createCalls[1]?.body).toMatchObject({
    confirmation_hash: 'a'.repeat(64),
    preview_token: 'preview_token_b12_customer',
  });

  await page.getByTestId('aftersale-cancel').click();
  await page.getByTestId('aftersale-command-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible();
  expect(backend.callsFor(`/api/v1/store/aftersales/${AFTERSALE_ID}/cancel`, 'POST')).toHaveLength(1);
  await expectNoHorizontalOverflow(page);

  const persisted = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(persisted).not.toContain('preview_token_b12_customer');
  expect(persisted).not.toContain('Development address');
});

test('MP-13 treats APPLY_AFTERSALE as server-authoritative and fails closed on reads', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 read/action matrix runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  await backend.install(page);
  await login(page);

  backend.orderActions = [];
  await navigate(page, `/pages/aftersales/apply?order_id=${ORDER_ID}`);
  await expect(page.getByTestId('aftersale-apply-unavailable')).toBeVisible();
  await expect(page.getByTestId('aftersale-preview-submit')).toHaveCount(0);

  for (const scenario of [
    { code: 'FORBIDDEN', status: 403 as const },
    { code: 'RATE_LIMITED', status: 429 as const, retryAfter: 7 },
    { code: 'INTERNAL_ERROR', status: 500 as const },
  ]) {
    backend.orderActions = ['APPLY_AFTERSALE'];
    backend.nextOrderFailure = scenario;
    await navigate(page, `/pages/aftersales/apply?order_id=${ORDER_ID}`, 'reLaunch');
    await expect(page.getByText('售后信息加载失败', { exact: true })).toBeVisible();
    await expect(page.getByTestId('aftersale-preview-submit')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }

  backend.nextOrderFailure = { code: 'AUTH_REQUIRED', status: 401 };
  await navigate(page, `/pages/aftersales/apply?order_id=${ORDER_ID}`, 'reLaunch');
  await expect(page).toHaveURL(/\/pages\/auth\/login$/);
});

test('MP-13 never bypasses a failed journal recovery through the error retry control', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The B12 corrupted journal recovery check runs once.');
  const backend = new MockMiniappAftersaleBackend();
  await backend.install(page);
  await login(page);
  await page.evaluate((key) => {
    sessionStorage.setItem(key, JSON.stringify({ schema_version: 1, entries: 'corrupted' }));
  }, 'qingxu:aftersale-confirms:v1');

  await navigate(page, `/pages/aftersales/apply?order_id=${ORDER_ID}`);
  await expect(page.getByText('售后信息加载失败', { exact: true })).toBeVisible();
  await expect(page.getByTestId('aftersale-preview-submit')).toHaveCount(0);
  expect(backend.callsFor(`/api/v1/store/orders/${ORDER_ID}`, 'GET')).toHaveLength(0);

  await uniButton(page, '重新加载').click();
  await expect(page.getByText('售后信息加载失败', { exact: true })).toBeVisible();
  await expect(page.getByTestId('aftersale-preview-submit')).toHaveCount(0);
  expect(backend.callsFor(`/api/v1/store/orders/${ORDER_ID}`, 'GET')).toHaveLength(0);

  await page.evaluate((key) => sessionStorage.removeItem(key), 'qingxu:aftersale-confirms:v1');
  await uniButton(page, '重新加载').click();
  await expect(page.getByTestId('aftersale-apply-ready')).toBeVisible();
  await expect(page.getByTestId('aftersale-preview-submit')).toBeVisible();
  expect(backend.callsFor(`/api/v1/store/orders/${ORDER_ID}`, 'GET')).toHaveLength(1);
});

test('MP-13/14 rotates failed preview keys and reuses confirm keys after a lost response', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 command matrix runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.previewSteps.push(
    { code: 'AFTERSALE_QUOTA_EXCEEDED', status: 422 },
    { code: 'RATE_LIMITED', status: 429, retryAfter: 8 },
    { kind: 'ABORT' },
  );
  backend.confirmSteps.push(
    { code: 'RESOURCE_VERSION_CONFLICT', status: 409 },
    { kind: 'ABORT' },
  );
  await backend.install(page);
  await login(page);
  await openApplication(page);
  await page.getByLabel('增加数量').click();

  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByRole('status')).toContainText('售后试算未通过');
  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByRole('status')).toContainText('8 秒后重试');
  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByRole('status')).toContainText('无法安全重放');
  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByTestId('aftersale-preview')).toBeVisible();

  const previewCalls = backend.callsFor('/api/v1/store/aftersales', 'POST')
    .filter(({ body }) => body?.action === 'PREVIEW');
  expect(previewCalls).toHaveLength(4);
  expect(previewCalls[0]?.headers['idempotency-key']).not.toBe(previewCalls[1]?.headers['idempotency-key']);
  expect(previewCalls[1]?.headers['idempotency-key']).not.toBe(previewCalls[2]?.headers['idempotency-key']);
  expect(previewCalls[2]?.headers['idempotency-key']).not.toBe(previewCalls[3]?.headers['idempotency-key']);

  await page.getByTestId('aftersale-confirm-submit').click();
  await expect(page.getByRole('status')).toContainText('重新试算并确认');
  await page.getByTestId('aftersale-preview-submit').click();
  await page.getByTestId('aftersale-confirm-submit').click();
  await expect(page.getByRole('status')).toContainText('结果暂时无法确认');
  await page.getByTestId('aftersale-confirm-retry').click();
  await expect(page.getByTestId('aftersale-detail-ready')).toBeVisible();

  const confirmCalls = backend.callsFor('/api/v1/store/aftersales', 'POST')
    .filter(({ body }) => body?.action === 'CONFIRM');
  expect(confirmCalls).toHaveLength(3);
  expect(confirmCalls[0]?.headers['idempotency-key']).not.toBe(confirmCalls[1]?.headers['idempotency-key']);
  expect(confirmCalls[1]?.headers['idempotency-key']).toBe(confirmCalls[2]?.headers['idempotency-key']);
  await expectNoHorizontalOverflow(page);
});

test('MP-13 clamps a stale quantity when a 409 refresh lowers the server quota', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 quota refresh check runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.confirmSteps.push({ code: 'RESOURCE_VERSION_CONFLICT', status: 409 });
  await backend.install(page);
  await login(page);
  await openApplication(page);
  await page.getByLabel('增加数量').click();
  await page.getByTestId('aftersale-preview-submit').click();
  await expect(page.getByTestId('aftersale-preview')).toBeVisible();

  backend.reservedAftersaleQuantity = 1;
  await page.getByTestId('aftersale-confirm-submit').click();

  await expect(page.getByRole('status')).toContainText('可退额度已变化');
  await expect(page.getByText('当前可选 0', { exact: false })).toBeVisible();
  await expect(page.getByTestId(`aftersale-quantity-${ORDER_ITEM_ID}`)).toHaveText('0');
  await expect(page.getByTestId('aftersale-preview-submit')).toHaveAttribute('disabled', 'true');
  await expectNoHorizontalOverflow(page);
});

test('MP-13 keeps the original confirm journal and key across a session state conflict', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 session recovery check runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.confirmSteps.push({ code: 'STATE_CONFLICT', status: 409 });
  await backend.install(page);
  await login(page);
  await openApplication(page);
  await page.getByLabel('增加数量').click();
  await page.getByTestId('aftersale-preview-submit').click();
  await page.getByTestId('aftersale-confirm-submit').click();

  await expect(page.getByRole('status')).toContainText('原确认操作已保留');
  await expect(page.getByTestId('aftersale-confirm-recovery')).toBeVisible();
  await expect(page.getByTestId('aftersale-preview-submit')).toHaveCount(0);
  await page.getByTestId('aftersale-confirm-retry').click();
  await expect(page.getByTestId('aftersale-detail-ready')).toBeVisible();

  const confirmCalls = backend.callsFor('/api/v1/store/aftersales', 'POST')
    .filter(({ body }) => body?.action === 'CONFIRM');
  expect(confirmCalls).toHaveLength(2);
  expect(confirmCalls[0]?.headers['idempotency-key'])
    .toBe(confirmCalls[1]?.headers['idempotency-key']);
});

test('MP-13 preserves a lost confirm through logout and same-account reauthentication', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The B12 reauthentication journal check runs once.');
  const backend = new MockMiniappAftersaleBackend();
  backend.confirmSteps.push({ kind: 'ABORT' });
  await backend.install(page);
  await login(page);
  await openApplication(page);
  await page.getByLabel('增加数量').click();
  await page.getByTestId('aftersale-preview-submit').click();
  await page.getByTestId('aftersale-confirm-submit').click();
  await expect(page.getByTestId('aftersale-confirm-recovery')).toBeVisible();
  await expect.poll(() => backend.callsFor('/api/v1/store/aftersales', 'POST')
    .filter(({ body }) => body?.action === 'CONFIRM').length).toBe(1);
  const firstConfirm = backend.callsFor('/api/v1/store/aftersales', 'POST')
    .find(({ body }) => body?.action === 'CONFIRM');

  await navigate(page, '/pages/profile/index', 'reLaunch');
  await uniButton(page, '退出登录').click();
  await page.getByText('退出', { exact: true }).last().click();
  await expect(page).toHaveURL(/\/#\/$/);
  const pendingAfterLogout = await page.evaluate((key) => sessionStorage.getItem(key),
    'qingxu:aftersale-confirms:v1');
  expect(pendingAfterLogout).toContain(firstConfirm?.headers['idempotency-key']);

  await login(page);
  await openApplication(page);
  await expect(page.getByTestId('aftersale-confirm-recovery')).toBeVisible();
  await page.getByTestId('aftersale-confirm-retry').click();
  await expect(page.getByTestId('aftersale-detail-ready')).toBeVisible();

  const confirmCalls = backend.callsFor('/api/v1/store/aftersales', 'POST')
    .filter(({ body }) => body?.action === 'CONFIRM');
  expect(confirmCalls).toHaveLength(2);
  expect(confirmCalls[0]?.headers['idempotency-key'])
    .toBe(confirmCalls[1]?.headers['idempotency-key']);
});

test('MP-14 exposes return shipment only when the service authorizes it', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 return-action authority check runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.detailActions = ['SUBMIT_RETURN_SHIPMENT', 'VIEW_ORDER'];
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/aftersales/detail?aftersale_id=${AFTERSALE_ID}`);
  await expect(page.getByTestId('aftersale-submit-shipment')).toBeVisible();
  await expect(page.getByTestId('aftersale-cancel')).toHaveCount(0);

  await page.getByTestId('aftersale-submit-shipment').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const inputs = dialog.locator('input');
  await expect(inputs).toHaveCount(3);
  await inputs.nth(0).fill('DEV');
  await inputs.nth(1).fill('Development Carrier');
  await inputs.nth(2).fill('B12-TRACK-001');
  await page.getByTestId('aftersale-command-submit').click();
  const call = backend.callsFor(`/api/v1/store/aftersales/${AFTERSALE_ID}/return-shipment`, 'POST')[0];
  expect(call?.body).toEqual({
    carrier_code: 'DEV', carrier_name: 'Development Carrier', tracking_no: 'B12-TRACK-001',
  });
  await expectNoHorizontalOverflow(page);
});

test('MP-14 shows canonical inspection evidence summaries without exposing capabilities', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The inspection evidence summary runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.inspectionEvidenceFileIds = [INSPECTION_FILE_ID];
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/aftersales/detail?aftersale_id=${AFTERSALE_ID}`);
  await expect(page.getByTestId('aftersale-inspection-evidence-summary')).toContainText('1 份受控留存');
  await expect(page.locator('body')).not.toContainText(INSPECTION_FILE_ID);

  backend.inspectionEvidenceFileIds = [];
  await navigate(page, `/pages/aftersales/detail?aftersale_id=${AFTERSALE_ID}`);
  await expect(page.getByTestId('aftersale-inspection-evidence-summary')).toContainText('无证据');
  await expectNoHorizontalOverflow(page);
});

test('MP-14 renders the exact total for contract-sized refund amounts', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 exact-money check runs at 390 and 1024 widths.');
  const backend = new MockMiniappAftersaleBackend();
  backend.detailItemAmounts = ['9999999999999999.99', '0.01'];
  await backend.install(page);
  await login(page);
  await navigate(page, `/pages/aftersales/detail?aftersale_id=${AFTERSALE_ID}`);

  await expect(page.getByTestId('aftersale-requested-total')).toHaveText('申请 ¥10000000000000000.00');
  await expectNoHorizontalOverflow(page);
});
