import { expect, test, type Page, type Route } from '@playwright/test';

const ACCESS_TOKEN = ['access', 'b11', 'admin'].join('-');
const REFRESH_TOKEN = ['refresh', 'b11', 'admin'].join('-');
const PREAUTH_TOKEN = ['preauth', 'b11', 'admin'].join('-');
const ACCOUNT_ID = '01J10000000000000000000000';
const SESSION_ID = '01J20000000000000000000000';
const CUSTOMER_ID = '01J30000000000000000000000';
const PRODUCT_ID = '01J40000000000000000000000';
const SKU_ID = '01J50000000000000000000000';
const ORDER_ID = '01J60000000000000000000000';
const ORDER_ITEM_ID = '01J70000000000000000000000';
const SHIPMENT_ID = '01J80000000000000000000000';
const SNAPSHOT_ID = '01J90000000000000000000000';
const EVENT_ID = '01JA0000000000000000000000';
const RAW_PHONE = ['100', '0000', '0000'].join('');
const RAW_ADDRESS = ['B11', ' controlled development ', 'address'].join('');
const RAW_RECIPIENT = 'Development Recipient';
const CARRIER_NAME = 'B11 Development Carrier';
const TRACKING_NO = 'B11-TRACK-001';
const EVENT_DESCRIPTION = '包裹已进入运输环节';
const ADDRESS_REASON = '核对本次开发验收订单的发货信息';

interface RecordedCall {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: URLSearchParams;
}

type FailureStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500;
type PlannedFailure = {
  bumpVersion?: boolean;
  code: string;
  kind: 'FAILURE';
  retryAfterSeconds?: number;
  status: FailureStatus;
};
type ReadStep = { kind: 'ABORT' } | PlannedFailure;
type CommandStep = { delayMs?: number; kind: 'SUCCESS' } | ReadStep;
type FulfillmentPhase = 'COMPLETED' | 'IN_TRANSIT' | 'READY' | 'SHIPPED';
type CommandKind = 'COMPLETE' | 'LOGISTICS' | 'SHIP';

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b11_admin' };
}

function failure(code: string, message = RAW_ADDRESS) {
  return { code, message, request_id: 'req_b11_admin_error' };
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

function session() {
  return {
    access_token: ACCESS_TOKEN,
    account_id: ACCOUNT_ID,
    assurance: 'MFA',
    expires_at: '2099-08-31T12:00:00.000Z',
    mfa_required: false,
    refresh_token: REFRESH_TOKEN,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: SESSION_ID,
  } as const;
}

class MockAdminFulfillmentBackend {
  readonly calls: RecordedCall[] = [];
  readonly commandPlans: Record<CommandKind, CommandStep[]> = {
    COMPLETE: [],
    LOGISTICS: [],
    SHIP: [],
  };
  readonly commandWinners = new Map<string, CommandKind>();
  detailDelayOnceMs = 0;
  listDelayOnceMs = 0;
  listEmpty = false;
  nextAddressStep: ReadStep | null = null;
  nextDetailStep: ReadStep | null = null;
  nextListStep: ReadStep | null = null;
  orderVersion = 5;
  packageVersion = 0;
  phase: FulfillmentPhase = 'READY';
  refreshFailure = false;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/admin/**', (route) => this.handle(route));
  }

  callsFor(path: string, method?: string): RecordedCall[] {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method));
  }

  private record(route: Route): RecordedCall {
    const request = route.request();
    const url = new URL(request.url());
    const call = {
      body: request.postData() ? request.postDataJSON() : null,
      headers: request.headers(),
      method: request.method(),
      path: url.pathname,
      query: new URLSearchParams(url.search),
    };
    this.calls.push(call);
    return call;
  }

  private orderStatus() {
    if (this.phase === 'READY') return 'PENDING_SHIPMENT' as const;
    if (this.phase === 'COMPLETED') return 'COMPLETED' as const;
    return 'SHIPPING' as const;
  }

  private fulfillmentStatus() {
    if (this.phase === 'READY') return 'READY_TO_SHIP' as const;
    if (this.phase === 'COMPLETED') return 'DELIVERED' as const;
    return this.phase;
  }

  private displayStatus(): string {
    return ({ COMPLETED: '已完成', IN_TRANSIT: '运输中', READY: '待发货', SHIPPED: '已发货' })[this.phase];
  }

  private logisticsEvent() {
    return {
      carrier_code: null,
      carrier_name: null,
      description: EVENT_DESCRIPTION,
      event_id: EVENT_ID,
      event_key: 'b11-admin-in-transit',
      event_type: 'STATUS',
      location: 'Development sorting centre',
      occurred_at: '2099-08-31T02:10:00.000Z',
      reason: null,
      status_code: 'IN_TRANSIT',
      tracking_no: null,
    } as const;
  }

  private shipment() {
    return {
      carrier_code: 'DEV',
      carrier_name: CARRIER_NAME,
      delivered_at: this.phase === 'COMPLETED' ? '2099-08-31T03:00:00.000Z' : null,
      items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
      order_id: ORDER_ID,
      shipment_id: SHIPMENT_ID,
      shipped_at: '2099-08-31T02:00:00.000Z',
      status: this.fulfillmentStatus() === 'READY_TO_SHIP' ? 'SHIPPED' : this.fulfillmentStatus(),
      tracking_no: TRACKING_NO,
      version: this.packageVersion,
    };
  }

  private orderItem() {
    return {
      line_amount: '78.00',
      order_item_id: ORDER_ITEM_ID,
      product_id: PRODUCT_ID,
      product_name: 'B11 洗护套装',
      quantity: 2,
      refunded_quantity: 0,
      reserved_aftersale_quantity: 0,
      shipped_quantity: this.phase === 'READY' ? 0 : 2,
      sku_id: SKU_ID,
      sku_name: '标准装',
      unit_price: '39.00',
    };
  }

  private orderPackage() {
    if (this.phase === 'READY') return [];
    const shipment = this.shipment();
    return [{
      carrier_name: shipment.carrier_name,
      delivered_at: shipment.delivered_at,
      events: this.phase === 'SHIPPED' ? [] : [this.logisticsEvent()],
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_name: 'B11 洗护套装',
        quantity: 2,
        sku_id: SKU_ID,
        sku_name: '标准装',
      }],
      shipment_id: SHIPMENT_ID,
      shipped_at: shipment.shipped_at,
      status: shipment.status,
      tracking_no: shipment.tracking_no,
      version: shipment.version,
    }];
  }

  private availableActions() {
    if (this.phase === 'READY') return ['READ_FULFILLMENT_ADDRESS', 'SHIP'] as const;
    if (this.phase === 'SHIPPED' || this.phase === 'IN_TRANSIT') {
      return ['READ_FULFILLMENT_ADDRESS', 'ADD_LOGISTICS_EVENT', 'COMPLETE'] as const;
    }
    return [] as const;
  }

  private detail() {
    return {
      aftersales: [],
      amounts: { goods: '78.00', paid: '78.00', payable: '78.00', refunded: '0.00', shipping: '0.00' },
      attribution: { agent_id: null, agent_name: null, frozen_at: null, source: 'DIRECT' },
      available_actions: this.availableActions(),
      close_reason: null,
      commission_impact: [],
      completion_reason: this.phase === 'COMPLETED' ? 'ADMIN_FORCED' : null,
      customer: {
        customer_alias: 'Development Customer',
        customer_id: CUSTOMER_ID,
        nickname_masked: 'D***',
        phone_masked: '1** **** 0000',
      },
      display_status: this.displayStatus(),
      errors: [],
      fulfillment_status: this.fulfillmentStatus(),
      inventory_impact: [],
      items: [this.orderItem()],
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: this.orderStatus(),
      packages: this.orderPackage(),
      pay_expires_at: '2099-08-31T01:30:00.000Z',
      payment_attempts: [],
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_attempts: [],
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      shipping_address_masked: {
        detail_masked: 'Development ***',
        phone_masked: '1** **** 0000',
        recipient_name_masked: 'D***',
        region_summary: 'Development Province Development City',
      },
      timeline: [{
        axis: 'ORDER',
        event: this.phase === 'COMPLETED' ? 'ORDER_COMPLETED' : 'ORDER_PAID',
        event_id: `${ORDER_ID}:timeline`,
        from_status: this.phase === 'COMPLETED' ? 'SHIPPING' : 'PENDING_PAYMENT',
        occurred_at: this.phase === 'COMPLETED'
          ? '2099-08-31T03:00:00.000Z'
          : '2099-08-31T01:00:00.000Z',
        to_status: this.orderStatus(),
      }],
      version: this.orderVersion,
    };
  }

  private listItem() {
    return {
      agent_id: null,
      agent_name: null,
      created_at: '2099-08-31T01:00:00.000Z',
      customer_alias: 'Development Customer',
      customer_id: CUSTOMER_ID,
      display_status: this.displayStatus(),
      fulfillment_status: this.fulfillmentStatus(),
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: this.orderStatus(),
      payable_amount: '78.00',
      payment_status: 'PAID',
      recipient_phone_masked: '1** **** 0000',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      version: this.orderVersion,
    };
  }

  private commandResult() {
    return {
      address_snapshot: this.detail().shipping_address_masked,
      aftersale_ids: [],
      amounts: this.detail().amounts,
      close_reason: null,
      completion_reason: 'ADMIN_FORCED',
      display_status: '已完成',
      fulfillment_status: 'DELIVERED',
      items: [this.orderItem()],
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: 'COMPLETED',
      payment_attempts: [],
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      version: this.orderVersion,
    };
  }

  private address() {
    return {
      access_expires_at: '2099-08-31T04:10:00.000Z',
      city: 'Development City',
      detail: RAW_ADDRESS,
      district: 'Development District',
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      phone: RAW_PHONE,
      province: 'Development Province',
      purpose: 'ORDER_FULFILLMENT',
      recipient_name: RAW_RECIPIENT,
      snapshot_at: '2099-08-31T01:00:00.000Z',
      snapshot_id: SNAPSHOT_ID,
    };
  }

  private async applyReadStep(route: Route, step: ReadStep): Promise<void> {
    if (step.kind === 'ABORT') {
      await route.abort('connectionreset');
      return;
    }
    if (step.bumpVersion) this.orderVersion += 1;
    const headers = step.retryAfterSeconds === undefined
      ? {}
      : { 'Retry-After': String(step.retryAfterSeconds) };
    await fulfill(route, step.status, failure(step.code), headers);
  }

  private applySuccess(kind: CommandKind): void {
    if (kind === 'SHIP') {
      this.phase = 'SHIPPED';
      this.packageVersion = 1;
    } else if (kind === 'LOGISTICS') {
      this.phase = 'IN_TRANSIT';
      this.packageVersion += 1;
    } else {
      this.phase = 'COMPLETED';
      this.packageVersion += 1;
    }
    this.orderVersion += 1;
  }

  private async commandResponse(route: Route, kind: CommandKind, status = 200): Promise<void> {
    if (kind === 'SHIP') {
      await fulfill(route, status, success(this.shipment()));
    } else if (kind === 'LOGISTICS') {
      await fulfill(route, status, success({ events: [this.logisticsEvent()], shipment: this.shipment() }));
    } else {
      await fulfill(route, status, success(this.commandResult()));
    }
  }

  private async handleCommand(route: Route, call: RecordedCall, kind: CommandKind): Promise<void> {
    const idempotencyKey = call.headers['idempotency-key'];
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const winner = this.commandWinners.get(idempotencyKey);
    if (winner !== undefined) {
      expect(winner).toBe(kind);
      await this.commandResponse(route, kind, kind === 'SHIP' ? 201 : 200);
      return;
    }
    const expectedVersion = kind === 'LOGISTICS' ? this.packageVersion : this.orderVersion;
    expect(call.headers['if-match']).toBe(`"${expectedVersion}"`);

    const step = this.commandPlans[kind].shift() ?? { kind: 'SUCCESS' };
    if (step.kind === 'FAILURE') {
      await this.applyReadStep(route, step);
      return;
    }
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    this.applySuccess(kind);
    this.commandWinners.set(idempotencyKey, kind);
    if (step.kind === 'ABORT') {
      await route.abort('connectionreset');
      return;
    }
    await this.commandResponse(route, kind, kind === 'SHIP' ? 201 : 200);
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);

    if (call.path === '/api/v1/admin/auth/login' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success({
        assurance: 'PASSWORD_ONLY',
        challenge_id: 'b11-admin-login-challenge',
        expires_at: '2099-08-31T01:05:00.000Z',
        mfa_required: true,
        next_action: 'VERIFY_TOTP',
        pre_auth_token: PREAUTH_TOKEN,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/auth/mfa/challenges/b11-admin-login-challenge/verify') {
      expect(call.headers.authorization).toBe(`Bearer ${PREAUTH_TOKEN}`);
      await fulfill(route, 200, success(session()));
      return;
    }
    if (call.path === '/api/v1/admin/auth/refresh') {
      await fulfill(
        route,
        this.refreshFailure ? 401 : 200,
        this.refreshFailure ? failure('AUTH_EXPIRED') : success(session()),
      );
      return;
    }

    expect(call.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    if (call.path === '/api/v1/admin/brands' && call.method === 'GET') {
      await fulfill(route, 200, success({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }));
      return;
    }
    if (call.path === '/api/v1/admin/orders' && call.method === 'GET') {
      if (this.listDelayOnceMs > 0) {
        const delay = this.listDelayOnceMs;
        this.listDelayOnceMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.nextListStep !== null) {
        const step = this.nextListStep;
        this.nextListStep = null;
        await this.applyReadStep(route, step);
        return;
      }
      await fulfill(route, 200, success({
        items: this.listEmpty ? [] : [this.listItem()],
        pagination: { page: 1, page_size: 20, total: this.listEmpty ? 0 : 1 },
      }));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}` && call.method === 'GET') {
      if (this.detailDelayOnceMs > 0) {
        const delay = this.detailDelayOnceMs;
        this.detailDelayOnceMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.nextDetailStep !== null) {
        const step = this.nextDetailStep;
        this.nextDetailStep = null;
        await this.applyReadStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.detail()));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}/fulfillment-address` && call.method === 'GET') {
      expect(call.headers['x-access-purpose']).toBe('ORDER_FULFILLMENT');
      expect(call.headers['x-access-reason']).toBe(`UTF-8''${encodeURIComponent(ADDRESS_REASON)}`);
      expect(decodeURIComponent(call.headers['x-access-reason'].slice(7))).toBe(ADDRESS_REASON);
      if (this.nextAddressStep !== null) {
        const step = this.nextAddressStep;
        this.nextAddressStep = null;
        await this.applyReadStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.address()));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}/shipments` && call.method === 'POST') {
      await this.handleCommand(route, call, 'SHIP');
      return;
    }
    if (call.path === `/api/v1/admin/shipments/${SHIPMENT_ID}/events` && call.method === 'POST') {
      await this.handleCommand(route, call, 'LOGISTICS');
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}/complete` && call.method === 'POST') {
      await this.handleCommand(route, call, 'COMPLETE');
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE', `${call.method} ${call.path}`));
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('超级管理员账号').fill('b11.admin');
  await page.getByLabel('登录密码').fill(['Runtime', 'Password', 'B11'].join(''));
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/login\/totp$/);
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

async function openOrders(page: Page): Promise<void> {
  await page.getByTitle('订单中心').click();
  await expect(page).toHaveURL(/\/orders$/);
}

async function openOrderDetail(page: Page): Promise<void> {
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${ORDER_ID}$`));
  await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();
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
  expect(storage).not.toContain(RAW_PHONE);
  expect(storage).not.toContain(RAW_ADDRESS);
  expect(storage).not.toContain(RAW_RECIPIENT);
  expect(storage).not.toContain(CARRIER_NAME);
  expect(storage).not.toContain(TRACKING_NO);
  expect(storage).not.toContain(EVENT_DESCRIPTION);
}

function isStateMatrixProject(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

function inputIn(page: Page, testId: string) {
  return page.getByTestId(testId);
}

async function fillShipment(page: Page): Promise<void> {
  await inputIn(page, 'order-shipment-carrier-code').fill('DEV');
  await inputIn(page, 'order-shipment-carrier-name').fill(CARRIER_NAME);
  await inputIn(page, 'order-shipment-tracking-no').fill(TRACKING_NO);
}

test('ADM-09/10/11 completes the controlled fulfillment path at every viewport', async ({ page }) => {
  const backend = new MockAdminFulfillmentBackend();
  await backend.install(page);
  await signIn(page);
  await openOrders(page);
  await expect(page.getByTestId(`admin-order-row-${ORDER_ID}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openOrderDetail(page);
  await expect(page.getByTestId('admin-order-masked-address')).not.toContainText(RAW_ADDRESS);
  await expect(page.locator('body')).not.toContainText(RAW_PHONE);
  await expectNoHorizontalOverflow(page);

  await page.getByTestId('admin-order-read-address').click();
  await inputIn(page, 'fulfillment-address-reason').fill(ADDRESS_REASON);
  await page.getByTestId('fulfillment-address-read').click();
  await expect(page.getByTestId('fulfillment-address-plaintext')).toContainText(RAW_PHONE);
  await expect(page.getByTestId('fulfillment-address-plaintext')).toContainText(RAW_ADDRESS);
  await expectNoPersistedPii(page);
  await page.getByTestId('fulfillment-address-close').click();
  await expect(page.getByTestId('fulfillment-address-plaintext')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(RAW_PHONE);
  await expect(page.locator('body')).not.toContainText(RAW_ADDRESS);
  await expect(page.locator('body')).not.toContainText(RAW_RECIPIENT);
  await page.getByTestId('admin-order-read-address').click();
  await expect(inputIn(page, 'fulfillment-address-reason')).toHaveValue('');
  await page.getByTestId('fulfillment-address-close').click();

  await page.getByTestId('admin-order-ship').click();
  await fillShipment(page);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('order-ship-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByTestId('admin-order-logistics')).toBeVisible();
  await expect(page.getByTestId('admin-order-package')).toContainText('包裹版本');
  await expect(page.getByTestId('admin-order-package')).toContainText('1');

  await page.getByTestId('admin-order-logistics').click();
  await inputIn(page, 'order-logistics-description').fill(EVENT_DESCRIPTION);
  await inputIn(page, 'order-logistics-location').fill('Development sorting centre');
  await page.getByTestId('order-logistics-submit').click();
  await expect(page.getByTestId('admin-order-logistics-timeline')).toContainText(EVENT_DESCRIPTION);
  await expect(page.getByTestId('admin-order-package')).toContainText('2');

  await page.getByTestId('admin-order-complete').click();
  await page.getByTestId('order-complete-reason').fill('已核验包裹签收事实');
  await page.getByTestId('order-complete-submit').click();
  await expect(page.getByTestId('admin-order-actions')).toContainText('已完成');
  await expect(page.getByTestId('admin-order-package')).toContainText('DELIVERED');
  await expectNoHorizontalOverflow(page);
  await expectNoPersistedPii(page);

  const shipCalls = backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/shipments`, 'POST');
  expect(shipCalls).toHaveLength(1);
  expect(shipCalls[0]?.body).toEqual({
    carrier_code: 'DEV',
    carrier_name: CARRIER_NAME,
    items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
    tracking_no: TRACKING_NO,
  });
  expect(shipCalls[0]?.headers['if-match']).toBe('"5"');
  expect(backend.callsFor(`/api/v1/admin/shipments/${SHIPMENT_ID}/events`, 'POST')[0]?.headers['if-match'])
    .toBe('"1"');
  expect(backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/complete`, 'POST')[0]?.headers['if-match'])
    .toBe('"7"');
});

test('ADM-09 keeps loading, empty, 403, 429, 500 and network failures closed', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The list state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminFulfillmentBackend();
  backend.listDelayOnceMs = 1_200;
  await backend.install(page);
  await signIn(page);
  await openOrders(page);
  await expect(page.getByTestId('admin-orders-loading')).toBeVisible();
  await expect(page.getByTestId(`admin-order-row-${ORDER_ID}`)).toBeVisible();

  backend.listEmpty = true;
  await page.getByRole('button', { name: '刷新订单' }).click();
  await expect(page.getByTestId('admin-orders-empty')).toBeVisible();
  backend.listEmpty = false;

  for (const scenario of [
    { code: 'FORBIDDEN', kind: 'FAILURE', status: 403 as const },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 8, status: 429 as const },
    { code: 'INTERNAL_ERROR', kind: 'FAILURE', status: 500 as const },
    { kind: 'ABORT' as const },
  ]) {
    backend.nextListStep = scenario;
    await page.getByRole('button', { name: '刷新订单' }).click();
    await expect(page.getByTestId('admin-orders-error')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(RAW_ADDRESS);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId(`admin-order-row-${ORDER_ID}`)).toBeVisible();
  }
});

test('ADM-10 exposes slow detail and a safe 404 state', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The detail state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminFulfillmentBackend();
  await backend.install(page);
  await signIn(page);
  await openOrders(page);

  backend.detailDelayOnceMs = 1_200;
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await expect(page.getByTestId('admin-order-detail-loading')).toBeVisible();
  await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();

  backend.nextDetailStep = { code: 'RESOURCE_NOT_FOUND', kind: 'FAILURE', status: 404 };
  await page.getByTestId('admin-order-refresh').click();
  await expect(page.getByTestId('admin-order-detail-error')).toContainText('订单不存在或已不可访问');
  await expect(page.locator('body')).not.toContainText(RAW_ADDRESS);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();
});

test('ADM-09 redirects to login when order authentication and refresh fail', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The authentication state runs at 390 and 1024 widths.');
  const backend = new MockAdminFulfillmentBackend();
  await backend.install(page);
  await signIn(page);
  await openOrders(page);
  await expect(page.getByTestId(`admin-order-row-${ORDER_ID}`)).toBeVisible();

  backend.refreshFailure = true;
  backend.nextListStep = { code: 'AUTH_EXPIRED', kind: 'FAILURE', status: 401 };
  await page.getByRole('button', { name: '刷新订单' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '登录总部管理后台' })).toBeVisible();
});

test('ADM-11 refreshes 409, rejects 422/403/429 and replays a lost response once', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The command matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminFulfillmentBackend();
  backend.commandPlans.SHIP.push(
    { bumpVersion: true, code: 'RESOURCE_VERSION_CONFLICT', kind: 'FAILURE', status: 409 },
    { code: 'ACTIVE_AFTERSALE_BLOCKS_SHIPMENT', kind: 'FAILURE', status: 422 },
    { code: 'FORBIDDEN', kind: 'FAILURE', status: 403 },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 11, status: 429 },
    { kind: 'ABORT' },
  );
  await backend.install(page);
  await signIn(page);
  await openOrders(page);
  await openOrderDetail(page);

  await page.getByTestId('admin-order-ship').click();
  await fillShipment(page);
  await page.getByTestId('order-ship-submit').click();
  await expect(page.getByText(/订单或包裹版本已变化，已刷新最新投影/, { exact: false })).toBeVisible();
  await expect(page.getByText(/订单版本 6/, { exact: false })).toBeVisible();

  await page.getByTestId('admin-order-ship').click();
  await fillShipment(page);
  await page.getByTestId('order-ship-submit').click();
  await expect(page.getByTestId('order-command-error')).toContainText('订单存在活动售后占用');
  await page.getByTestId('order-ship-submit').click();
  await expect(page.getByTestId('order-command-error')).toContainText('当前账号无权执行该履约操作');
  await page.getByTestId('order-ship-submit').click();
  await expect(page.getByTestId('order-command-error')).toContainText('11 秒后重试');
  await page.getByTestId('order-ship-submit').click();
  await expect(page.getByTestId('order-command-uncertain')).toBeVisible();
  await page.getByTestId('order-ship-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByTestId('admin-order-logistics')).toBeVisible();

  const calls = backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/shipments`, 'POST');
  expect(calls).toHaveLength(6);
  expect(calls.map(({ headers }) => headers['if-match']))
    .toEqual(['"5"', '"6"', '"6"', '"6"', '"6"', '"6"']);
  const keys = calls.map(({ headers }) => headers['idempotency-key']);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[1]).not.toBe(keys[2]);
  expect(keys[2]).not.toBe(keys[3]);
  expect(keys[3]).not.toBe(keys[4]);
  expect(keys[4]).toBe(keys[5]);
  await expectNoHorizontalOverflow(page);
  await expectNoPersistedPii(page);
});

test.skip('ADM-10 address auto-expiry is exercised with the real five-minute clock in B11.5 vertical testing', async () => {
  // Designed skip: B11.4 verifies explicit close/unmount cleanup without replacing the application clock.
});
