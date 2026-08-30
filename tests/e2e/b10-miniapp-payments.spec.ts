import { expect, test, type Page, type Route } from '@playwright/test';

const CUSTOMER_ID = '01J20000000000000000000000';
const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const ORDER_ID = '01J90000000000000000000000';
const ORDER_ITEM_ID = '01JA0000000000000000000000';
const PAYMENT_INTENT_ID = '01JB0000000000000000000000';
const PAYMENT_ATTEMPT_ID = '01JC0000000000000000000000';
const REFUND_ID = '01JD0000000000000000000000';
const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const PHONE = ['100', '0000', '0000'].join('');
const LOGIN_CODE = 'mock:b10_miniapp_customer';
const CAPABILITY_SIGNATURE = 'b10-memory-only-payment-signature';
const CAPABILITY_PREPAY = 'prepay_id=b10-memory-only-prepay';

type PaymentPhase =
  | 'READY'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'CLOSING'
  | 'TIMEOUT'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'MANUAL';

type IntentPlan =
  | { kind: 'ABORT' }
  | { kind: 'SUCCESS' }
  | { code: string; kind: 'FAILURE'; retryAfterSeconds?: number; status: 409 | 429 | 503 };

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
}

function success(data: unknown) {
  return { code: 'OK', message: 'success', data, request_id: 'req_b10_miniapp' };
}

function failure(code: string, message: string) {
  return { code, message, request_id: 'req_b10_miniapp_error' };
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

class MockB10MiniappBackend {
  readonly calls: Call[] = [];
  readonly intentPlans: IntentPlan[] = [];
  phase: PaymentPhase = 'READY';
  orderVersion = 1;
  paymentDelayMs = 0;
  includeProviderCapability = false;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  count(path: string, method?: string): number {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method)).length;
  }

  paymentCalls(): Call[] {
    return this.calls.filter(({ method, path }) => method === 'POST' &&
      path === `/api/v1/store/orders/${ORDER_ID}/payment-intents`);
  }

  private paymentAttempt() {
    const status = this.phase === 'FAILED'
      ? 'FAILED'
      : this.phase === 'CANCELLED'
        ? 'CANCELLED'
        : this.phase === 'SUCCESS' || this.phase === 'MANUAL'
          ? 'SUCCEEDED'
          : this.phase === 'REFUNDING' || this.phase === 'REFUNDED'
            ? 'SUCCEEDED_LATE'
            : 'INITIATED';
    const lastError = status === 'FAILED'
      ? {
          error_code: 'PAYMENT_FAILED',
          message: '支付未完成',
          retryable: true,
          occurred_at: '2099-08-29T01:02:00.000Z',
        }
      : null;
    return {
      payment_attempt_id: PAYMENT_ATTEMPT_ID,
      intent_no: `PI${PAYMENT_INTENT_ID}`,
      status,
      amount: '78.00',
      provider_transaction_id_masked: status === 'SUCCEEDED' || status === 'SUCCEEDED_LATE'
        ? 'txn_****_b10'
        : null,
      last_error: lastError,
      created_at: '2099-08-29T01:01:00.000Z',
      updated_at: '2099-08-29T01:02:00.000Z',
    };
  }

  private refundAttempt() {
    return {
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      attempt_no: 1,
      origin_type: 'LATE_PAYMENT',
      status: this.phase === 'REFUNDED' ? 'SUCCEEDED' : 'PROCESSING',
      amount: '78.00',
      last_error: null,
      created_at: '2099-08-29T01:03:00.000Z',
      updated_at: '2099-08-29T01:03:00.000Z',
    };
  }

  private axes() {
    const closed = ['TIMEOUT', 'REFUNDING', 'REFUNDED'].includes(this.phase);
    const paid = ['SUCCESS', 'REFUNDING', 'REFUNDED', 'MANUAL'].includes(this.phase);
    const processing = this.phase === 'PROCESSING' || this.phase === 'CLOSING';
    const displayStatus: Record<PaymentPhase, string> = {
      READY: '待付款',
      PROCESSING: '支付确认中',
      SUCCESS: '待发货',
      FAILED: '待付款',
      CANCELLED: '待付款',
      CLOSING: '关单确认中',
      TIMEOUT: '已关闭',
      REFUNDING: '退款处理中',
      REFUNDED: '退款完成',
      MANUAL: '支付异常处理中',
    };
    return {
      order_status: this.phase === 'SUCCESS' ? 'PENDING_SHIPMENT' : closed ? 'CLOSED' : 'PENDING_PAYMENT',
      payment_status: paid ? 'PAID' : processing ? 'PROCESSING' : 'UNPAID',
      refund_progress_status: this.phase === 'REFUNDED' ? 'FULL' : 'NONE',
      refund_processing_status: this.phase === 'REFUNDING' ? 'REFUNDING' : 'IDLE',
      fulfillment_status: this.phase === 'SUCCESS' ? 'READY_TO_SHIP' : 'NOT_STARTED',
      close_reason: this.phase === 'TIMEOUT' ? 'PAYMENT_TIMEOUT' : closed ? 'USER_CANCELLED' : null,
      completion_reason: null,
      payment_resolution: this.phase === 'REFUNDING'
        ? 'LATE_SUCCESS_REFUND_PENDING'
        : this.phase === 'REFUNDED'
          ? 'LATE_SUCCESS_REFUNDED'
          : this.phase === 'MANUAL'
            ? 'MANUAL_REQUIRED'
            : 'NORMAL',
      display_status: displayStatus[this.phase],
    };
  }

  private commandOrder() {
    const axes = this.axes();
    const paid = axes.payment_status === 'PAID' ? '78.00' : '0.00';
    const refunded = this.phase === 'REFUNDED' ? '78.00' : '0.00';
    return {
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      ...axes,
      pay_expires_at: '2099-08-29T01:30:00.000Z',
      server_time: '2099-08-29T01:00:00.000Z',
      amounts: {
        goods: '78.00', shipping: '0.00', payable: '78.00', paid, refunded,
      },
      items: [{
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'B10 洗护套装',
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

  private detailOrder() {
    const hasAttempt = !['READY', 'TIMEOUT'].includes(this.phase);
    const actions = ['READY', 'FAILED', 'CANCELLED'].includes(this.phase)
      ? ['PAY', 'CANCEL']
      : [];
    const paymentAttempts = hasAttempt ? [this.paymentAttempt()] : [];
    const refundAttempts = ['REFUNDING', 'REFUNDED'].includes(this.phase)
      ? [this.refundAttempt()]
      : [];
    const errors = paymentAttempts
      .map(({ last_error }) => last_error)
      .filter((error): error is NonNullable<typeof error> => error !== null);
    if (this.phase === 'MANUAL') {
      errors.push({
        error_code: 'PAYMENT_MANUAL_REQUIRED',
        message: '支付事实需要人工核对',
        retryable: false,
        occurred_at: '2099-08-29T01:04:00.000Z',
      });
    }
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
      available_actions: actions,
      timeline: [{
        event_id: 'order-created',
        axis: 'ORDER',
        event: 'ORDER_CREATED',
        from_status: null,
        to_status: 'PENDING_PAYMENT',
        occurred_at: '2099-08-29T01:00:00.000Z',
      }],
      packages: [],
      aftersales: [],
      payment_attempts: paymentAttempts,
      refund_attempts: refundAttempts,
      errors,
      version: this.orderVersion,
    };
  }

  private paymentIntent() {
    return {
      payment_intent_id: PAYMENT_INTENT_ID,
      intent_no: `PI${PAYMENT_INTENT_ID}`,
      intent_status: 'OPEN',
      provider_payload: this.includeProviderCapability
        ? {
            app_id: 'wx-b10-development',
            time_stamp: '4099683600',
            nonce_str: 'b10-memory-only-nonce',
            package: CAPABILITY_PREPAY,
            sign_type: 'RSA',
            pay_sign: CAPABILITY_SIGNATURE,
            expires_at: '2099-08-29T01:05:00.000Z',
          }
        : null,
      expires_at: '2099-08-29T01:05:00.000Z',
      next_reconcile_at: null,
      last_error_code: null,
    };
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

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);
    const { method, path } = call;

    if (path === '/api/v1/store/legal-documents' && method === 'GET') {
      await fulfill(route, 200, success({
        user_agreement: { type: 'USER_AGREEMENT', document_version: 'b10-user', title: '用户协议', content_url: 'https://example.invalid/user', required: true },
        privacy_policy: { type: 'PRIVACY_POLICY', document_version: 'b10-privacy', title: '隐私政策', content_url: 'https://example.invalid/privacy', required: true },
        phone_authorization: { type: 'PHONE_AUTHORIZATION', document_version: 'b10-phone', title: '手机号授权说明', content_url: 'https://example.invalid/phone', required: true },
      }));
      return;
    }
    if (path === '/api/v1/store/auth/wechat/login' && method === 'POST') {
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
    if (path === '/api/v1/store/auth/refresh' && method === 'POST') {
      await fulfill(route, 401, failure('AUTH_REQUIRED', 'session expired'));
      return;
    }
    if (path === '/api/v1/store/profile' && method === 'GET') {
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
    if (path === '/api/v1/store/service-agent' && method === 'GET') {
      await fulfill(route, 200, success(null));
      return;
    }
    if (path === `/api/v1/store/orders/${ORDER_ID}` && method === 'GET') {
      await fulfill(route, 200, success(this.detailOrder()));
      return;
    }
    if (path === `/api/v1/store/orders/${ORDER_ID}/payment-intents` && method === 'POST') {
      const plan = this.intentPlans.shift() ?? { kind: 'SUCCESS' };
      if (this.paymentDelayMs > 0) {
        const milliseconds = this.paymentDelayMs;
        this.paymentDelayMs = 0;
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
      }
      if (plan.kind === 'ABORT') {
        await route.abort('connectionreset');
        return;
      }
      if (plan.kind === 'FAILURE') {
        if (plan.status === 409) this.orderVersion += 1;
        await fulfill(
          route,
          plan.status,
          failure(plan.code, 'planned payment failure'),
          plan.retryAfterSeconds === undefined
            ? {}
            : { 'Retry-After': String(plan.retryAfterSeconds) },
        );
        return;
      }
      this.phase = 'PROCESSING';
      await fulfill(route, 200, success(this.paymentIntent()));
      return;
    }
    if (path === `/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result` && method === 'POST') {
      const result = call.body?.result;
      this.phase = result === 'SUCCEEDED' ? 'SUCCESS' : result === 'FAILED' ? 'FAILED' : 'CANCELLED';
      await fulfill(route, 202, success(this.paymentIntent()));
      return;
    }
    if (path === `/api/v1/store/orders/${ORDER_ID}/cancel` && method === 'POST') {
      this.phase = 'CLOSING';
      this.orderVersion += 1;
      await fulfill(route, 202, success(this.commandOrder()));
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE', `${method} ${path}`));
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

async function navigate(
  page: Page,
  url: string,
  method: 'navigateTo' | 'reLaunch' = 'navigateTo',
): Promise<void> {
  await page.evaluate(({ target, runtimeMethod }) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: Record<string, (options: Record<string, unknown>) => unknown>;
    }).uni;
    runtime[runtimeMethod]?.({ fail: reject, success: resolve, url: target });
  }), { target: url, runtimeMethod: method });
}

async function openOrder(page: Page): Promise<void> {
  await navigate(page, `/pages/orders/detail?order_id=${ORDER_ID}`);
  await expect(page.getByText(`QX${ORDER_ID}`, { exact: true })).toBeVisible();
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

function paymentJournal(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem('qingxu:payment-submit:v1'));
}

test('B10.5 completes the server-confirmed Mock payment path at every acceptance viewport', async ({ page }, testInfo) => {
  const backend = new MockB10MiniappBackend();
  await backend.install(page);
  await login(page);
  await openOrder(page);

  await expect(uniButton(page, '支付订单')).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await uniButton(page, '支付订单').click();
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  await expect(page.getByText('正在确认支付结果', { exact: true })).toBeVisible();
  await expect(uniButton(page, '成功')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await uniButton(page, '成功').click();
  await expect(page.getByText('支付成功', { exact: true })).toBeVisible();
  await expect(page.getByText('订单已进入待发货阶段。', { exact: true })).toBeVisible();
  expect(backend.paymentCalls()).toHaveLength(1);
  expect(backend.count(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`, 'POST')).toBe(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('payment-success.png') });
});

test('B10.5 locks double-clicks to one payment intent request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The mutation matrix runs once.');
  const backend = new MockB10MiniappBackend();
  backend.paymentDelayMs = 2_000;
  await backend.install(page);
  await login(page);
  await openOrder(page);

  const button = uniButton(page, '支付订单');
  await button.evaluate((element) => {
    (element as HTMLElement).click();
    (element as HTMLElement).click();
  });
  await expect.poll(() => backend.paymentCalls().length).toBe(1);
  await expect(uniButton(page, '正在确认…')).toHaveAttribute('disabled', 'true');
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  const [call] = backend.paymentCalls();
  expect(call?.body).toBeNull();
  expect(call?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(call?.headers['if-match']).toBe('"1"');
});

test('B10.5 retries a lost response with the same idempotency key and If-Match', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The retry matrix runs once.');
  const backend = new MockB10MiniappBackend();
  backend.intentPlans.push({ kind: 'ABORT' }, { kind: 'SUCCESS' });
  await backend.install(page);
  await login(page);
  await openOrder(page);

  await uniButton(page, '支付订单').click();
  await expect(page.getByText(/支付请求结果暂时无法确认/)).toBeVisible();
  const stored = await paymentJournal(page);
  expect(stored).not.toBeNull();
  expect(Object.keys(JSON.parse(stored ?? '{}'))).toEqual([
    'order_id', 'order_version', 'idempotency_key',
  ]);
  expect(stored).not.toContain(PAYMENT_INTENT_ID);
  expect(stored).not.toContain('provider_payload');

  await uniButton(page, '继续确认支付请求').click();
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  const calls = backend.paymentCalls();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.headers['idempotency-key']).toBe(calls[1]?.headers['idempotency-key']);
  expect(calls[0]?.headers['if-match']).toBe(calls[1]?.headers['if-match']);
  expect(await paymentJournal(page)).toBeNull();
});

test('B10.5 refreshes on 409 and requires a new deliberate payment action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The conflict matrix runs once.');
  const backend = new MockB10MiniappBackend();
  backend.intentPlans.push(
    { code: 'PAYMENT_NOT_ALLOWED', kind: 'FAILURE', status: 409 },
    { kind: 'SUCCESS' },
  );
  await backend.install(page);
  await login(page);
  await openOrder(page);
  const detailPath = `/api/v1/store/orders/${ORDER_ID}`;
  const initialReads = backend.count(detailPath, 'GET');

  await uniButton(page, '支付订单').click();
  await expect(page.getByText(/订单或支付状态已变化，已刷新详情/)).toBeVisible();
  expect(backend.count(detailPath, 'GET')).toBe(initialReads + 1);
  expect(backend.paymentCalls()).toHaveLength(1);
  expect(await paymentJournal(page)).toBeNull();

  await uniButton(page, '支付订单').click();
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  const calls = backend.paymentCalls();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.headers['if-match']).toBe('"1"');
  expect(calls[1]?.headers['if-match']).toBe('"2"');
  expect(calls[0]?.headers['idempotency-key']).not.toBe(calls[1]?.headers['idempotency-key']);
});

test('B10.5 retains one payment command across 503 and 429 before convergence', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The unavailable matrix runs once.');
  const backend = new MockB10MiniappBackend();
  backend.intentPlans.push(
    { code: 'PAYMENT_PROVIDER_UNAVAILABLE', kind: 'FAILURE', status: 503 },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 7, status: 429 },
    { kind: 'SUCCESS' },
  );
  await backend.install(page);
  await login(page);
  await openOrder(page);

  await uniButton(page, '支付订单').click();
  await expect(page.getByText(/支付请求结果暂时无法确认/)).toBeVisible();
  const firstStored = await paymentJournal(page);
  expect(firstStored).not.toBeNull();

  await uniButton(page, '继续确认支付请求').click();
  await expect(page.getByText('请求较频繁，请在 7 秒后使用当前支付请求重试。', { exact: true }))
    .toBeVisible();
  expect(await paymentJournal(page)).toBe(firstStored);

  await uniButton(page, '继续确认支付请求').click();
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  const calls = backend.paymentCalls();
  expect(calls).toHaveLength(3);
  expect(new Set(calls.map(({ headers }) => headers['idempotency-key'])).size).toBe(1);
  expect(new Set(calls.map(({ headers }) => headers['if-match'])).size).toBe(1);
  expect(await paymentJournal(page)).toBeNull();
});

test('B10.5 treats cancel 202 as close-pending without claiming inventory release', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The cancel matrix runs once.');
  const backend = new MockB10MiniappBackend();
  await backend.install(page);
  await login(page);
  await openOrder(page);

  await uniButton(page, '取消订单').click();
  await confirmModal(page, '确认取消');
  await expect(page.getByText('关单确认中', { exact: true })).toBeVisible();
  await expect(page.getByText(/正在向支付服务确认关单，订单和库存预占仍保持/)).toBeVisible();
  await expect(page.getByText('订单已取消，服务端已确认关闭。', { exact: true }))
    .toHaveCount(0);
  const calls = backend.calls.filter(({ method, path }) => method === 'POST' &&
    path === `/api/v1/store/orders/${ORDER_ID}/cancel`);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.body).toBeNull();
  expect(calls[0]?.headers['if-match']).toBe('"1"');
  expect(backend.paymentCalls()).toHaveLength(0);
});

test('MP-09 trusts only the server projection for the complete payment state matrix', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The result matrix runs once.');
  const backend = new MockB10MiniappBackend();
  await backend.install(page);
  await login(page);

  const scenarios: ReadonlyArray<[PaymentPhase, string]> = [
    ['PROCESSING', '正在确认支付结果'],
    ['SUCCESS', '支付成功'],
    ['FAILED', '支付未完成'],
    ['CANCELLED', '支付已取消'],
    ['CLOSING', '正在确认关单'],
    ['TIMEOUT', '订单已超时'],
    ['REFUNDING', '迟到支付退款中'],
    ['REFUNDED', '迟到支付已退款'],
    ['MANUAL', '支付异常处理中'],
  ];

  for (const [phase, title] of scenarios) {
    backend.phase = phase;
    await navigate(
      page,
      `/pages/payment/result?order_id=${ORDER_ID}&status=SUCCEEDED&success=1`,
      'reLaunch',
    );
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    if (phase === 'FAILED') {
      await expect(page.getByText('支付成功', { exact: true })).toHaveCount(0);
    }
    await expectNoHorizontalOverflow(page);
  }
});

test('B10.5 never persists provider capability or payment intent data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The storage boundary runs once.');
  const backend = new MockB10MiniappBackend();
  backend.includeProviderCapability = true;
  await backend.install(page);
  await login(page);
  await openOrder(page);

  await uniButton(page, '支付订单').click();
  await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${ORDER_ID}$`));
  await expect(page.getByText('正在确认支付结果', { exact: true })).toBeVisible();
  await expect(uniButton(page, '成功')).toHaveCount(0);

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? '';
      return [key, localStorage.getItem(key)];
    })),
    session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? '';
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  const serialized = JSON.stringify(storage);
  expect(serialized).not.toContain(PAYMENT_INTENT_ID);
  expect(serialized).not.toContain(CAPABILITY_SIGNATURE);
  expect(serialized).not.toContain(CAPABILITY_PREPAY);
  expect(serialized).not.toContain('provider_payload');
  expect(serialized).not.toContain('pay_sign');
  expect(await paymentJournal(page)).toBeNull();
});
