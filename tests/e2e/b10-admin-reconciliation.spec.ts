import { expect, test, type Page, type Route } from '@playwright/test';

const accessToken = ['access', 'b10', 'runtime'].join('-');
const refreshToken = ['refresh', 'b10', 'runtime'].join('-');
const preauthToken = ['preauth', 'b10', 'runtime'].join('-');
const requestId = 'req_b10_admin_reconciliation';
const paymentIntentId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const settlementIntentId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const refundIntentId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const orderId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const settlementOrderId = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const refundOrderId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const refundId = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const restrictedValues = [
  'capability-secret-b10',
  'provider-payload-b10',
  'provider-transaction-b10',
  'customer-private-b10',
  'address-private-b10',
] as const;

type TaskType = 'PAYMENT_INTENT' | 'PAYMENT_SETTLEMENT' | 'LATE_PAYMENT_REFUND';

type ReconciliationTask =
  | {
      task_type: 'PAYMENT_INTENT';
      payment_intent_id: string;
      refund_id: null;
      order_id: string;
      reference_no: string;
      status: 'CREATING' | 'OPEN' | 'CLOSE_PENDING';
      payment_resolution: null;
      last_error_code: string | null;
      reconciliation_attempt_count: number;
      next_reconcile_at: string | null;
      version: number;
    }
  | {
      task_type: 'PAYMENT_SETTLEMENT';
      payment_intent_id: string;
      refund_id: null;
      order_id: string;
      reference_no: string;
      status: 'SUCCEEDED';
      payment_resolution: 'MANUAL_REQUIRED';
      last_error_code: string;
      reconciliation_attempt_count: number;
      next_reconcile_at: null;
      version: number;
    }
  | {
      task_type: 'LATE_PAYMENT_REFUND';
      payment_intent_id: string;
      refund_id: string;
      order_id: string;
      reference_no: string;
      status: 'PENDING' | 'PROCESSING' | 'FAILED';
      payment_resolution: 'LATE_SUCCESS_REFUND_PENDING' | 'MANUAL_REQUIRED';
      last_error_code: string | null;
      reconciliation_attempt_count: number;
      next_reconcile_at: string | null;
      version: number;
    };

interface RecordedCall {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: URLSearchParams;
}

interface ListFailure {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  status: 401 | 403 | 429 | 500;
}

type ReconcileStep =
  | { kind: 'ABORT' }
  | { kind: 'PENDING'; delayMs?: number }
  | { kind: 'CONVERGED'; delayMs?: number }
  | { kind: 'FAILURE'; code: string; status: 409 | 429 | 500; retryAfterSeconds?: number; bumpVersion?: boolean };

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

function failure(code: string, message: string) {
  return { code, message, request_id: requestId };
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
    access_token: accessToken,
    account_id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
    assurance: 'MFA',
    expires_at: '2099-08-30T03:00:00.000Z',
    mfa_required: false,
    refresh_token: refreshToken,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
  } as const;
}

function defaultTasks(): ReconciliationTask[] {
  return [
    {
      last_error_code: null,
      next_reconcile_at: '2026-08-30T02:00:00.000Z',
      order_id: orderId,
      payment_intent_id: paymentIntentId,
      payment_resolution: null,
      reconciliation_attempt_count: 1,
      reference_no: 'PI-LOCAL-001',
      refund_id: null,
      status: 'OPEN',
      task_type: 'PAYMENT_INTENT',
      version: 2,
    },
    {
      last_error_code: 'PAYMENT_CONFIGURATION_UNAVAILABLE',
      next_reconcile_at: null,
      order_id: settlementOrderId,
      payment_intent_id: settlementIntentId,
      payment_resolution: 'MANUAL_REQUIRED',
      reconciliation_attempt_count: 2,
      reference_no: 'PI-LOCAL-002',
      refund_id: null,
      status: 'SUCCEEDED',
      task_type: 'PAYMENT_SETTLEMENT',
      version: 3,
    },
    {
      last_error_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      next_reconcile_at: '2026-08-30T02:05:00.000Z',
      order_id: refundOrderId,
      payment_intent_id: refundIntentId,
      payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
      reconciliation_attempt_count: 3,
      reference_no: 'RF-LOCAL-001',
      refund_id: refundId,
      status: 'FAILED',
      task_type: 'LATE_PAYMENT_REFUND',
      version: 4,
    },
  ];
}

class MockAdminReconciliationBackend {
  tasks = defaultTasks();
  readonly listCalls: RecordedCall[] = [];
  readonly reconcileCalls: RecordedCall[] = [];
  readonly reconcilePlan: ReconcileStep[] = [];
  nextListDelayMs = 0;
  nextListFailure: ListFailure | null = null;
  nextListPayload: unknown | undefined;
  refreshFailure = false;

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/admin/**', (route) => this.handle(route));
  }

  private record(route: Route): RecordedCall {
    const request = route.request();
    const url = new URL(request.url());
    return {
      body: request.postData() ? request.postDataJSON() : null,
      headers: request.headers(),
      method: request.method(),
      path: url.pathname,
      query: new URLSearchParams(url.search),
    };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/v1/admin/auth/login') {
      expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success({
        assurance: 'PASSWORD_ONLY',
        challenge_id: 'b10-admin-login-challenge',
        expires_at: '2099-08-30T02:05:00.000Z',
        mfa_required: true,
        next_action: 'VERIFY_TOTP',
        pre_auth_token: preauthToken,
      }));
      return;
    }
    if (path === '/api/v1/admin/auth/mfa/challenges/b10-admin-login-challenge/verify') {
      expect(request.headers().authorization).toBe(`Bearer ${preauthToken}`);
      await fulfill(route, 200, success(session()));
      return;
    }
    if (path === '/api/v1/admin/auth/refresh') {
      if (this.refreshFailure) {
        await fulfill(route, 401, failure('AUTH_EXPIRED', 'expired'));
      } else {
        await fulfill(route, 200, success(session()));
      }
      return;
    }

    expect(request.headers().authorization).toBe(`Bearer ${accessToken}`);
    if (path === '/api/v1/admin/brands' && request.method() === 'GET') {
      await fulfill(route, 200, success({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }));
      return;
    }
    if (path === '/api/v1/admin/payment-intents/reconciliation-tasks' && request.method() === 'GET') {
      await this.handleList(route, url.searchParams);
      return;
    }
    const reconcileMatch = path.match(/^\/api\/v1\/admin\/payment-intents\/([^/]+)\/reconcile$/);
    if (reconcileMatch && request.method() === 'POST') {
      await this.handleReconcile(route, reconcileMatch[1] ?? 'missing');
      return;
    }
    await fulfill(route, 404, failure('NOT_FOUND', `No B10 admin mock for ${request.method()} ${path}`));
  }

  private async handleList(route: Route, query: URLSearchParams): Promise<void> {
    const call = this.record(route);
    this.listCalls.push(call);
    const delayMs = this.nextListDelayMs;
    this.nextListDelayMs = 0;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (this.nextListFailure) {
      const current = this.nextListFailure;
      this.nextListFailure = null;
      const headers = current.retryAfterSeconds
        ? { 'Retry-After': String(current.retryAfterSeconds) }
        : {};
      await fulfill(route, current.status, failure(current.code, current.message), headers);
      return;
    }
    if (this.nextListPayload !== undefined) {
      const payload = this.nextListPayload;
      this.nextListPayload = undefined;
      await fulfill(route, 200, payload);
      return;
    }

    const taskType = query.get('task_type') as TaskType | null;
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('page_size') ?? 20);
    const filtered = this.tasks.filter((task) => !taskType || task.task_type === taskType);
    const start = (page - 1) * pageSize;
    await fulfill(route, 200, success({
      items: filtered.slice(start, start + pageSize),
      pagination: { page, page_size: pageSize, total: filtered.length },
    }));
  }

  private async handleReconcile(route: Route, intentId: string): Promise<void> {
    const call = this.record(route);
    this.reconcileCalls.push(call);
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body).toEqual({});
    const step = this.reconcilePlan.shift() ?? { kind: 'PENDING' };
    if (step.kind === 'ABORT') {
      await route.abort('failed');
      return;
    }
    if ('delayMs' in step && step.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    const item = this.tasks.find((task) => task.payment_intent_id === intentId);
    if (!item) {
      await fulfill(route, 404, failure('NOT_FOUND', 'task is gone'));
      return;
    }
    if (step.kind === 'FAILURE') {
      if (step.bumpVersion) item.version += 1;
      const headers = step.retryAfterSeconds
        ? { 'Retry-After': String(step.retryAfterSeconds) }
        : {};
      await fulfill(route, step.status, failure(step.code, 'internal reconciliation detail'), headers);
      return;
    }
    if (step.kind === 'PENDING') {
      item.reconciliation_attempt_count += 1;
      await fulfill(route, 202, {
        code: 'ACCEPTED',
        data: item,
        message: 'accepted',
        request_id: requestId,
      });
      return;
    }

    this.tasks = this.tasks.filter((task) => task.payment_intent_id !== intentId);
    await fulfill(route, 200, success({
      last_error_code: null,
      order_id: item.order_id,
      outcome: 'CONVERGED',
      payment_intent_id: item.payment_intent_id,
      payment_intent_status: 'CLOSED',
      payment_resolution: 'NORMAL',
      refund_id: null,
      refund_status: null,
      version: item.version + 1,
    }));
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('超级管理员账号').fill('b10.admin');
  await page.getByLabel('登录密码').fill(['Runtime', 'Password', 'B10'].join(''));
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/login\/totp$/);
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

async function openReconciliation(page: Page): Promise<void> {
  await page.getByTitle('支付对账').click();
  await expect(page).toHaveURL(/\/orders\/reconciliation$/);
}

async function confirmReconcile(page: Page, intentId: string): Promise<void> {
  await page.getByTestId(`reconcile-${intentId}`).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function expectNoRestrictedValues(page: Page): Promise<void> {
  const body = page.locator('body');
  for (const value of restrictedValues) await expect(body).not.toContainText(value);
}

function isStateMatrixProject(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

test('ADM-10 completes pending and converged reconciliation at every acceptance viewport', async ({ page }) => {
  const backend = new MockAdminReconciliationBackend();
  backend.reconcilePlan.push({ kind: 'PENDING' }, { kind: 'CONVERGED' });
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);

  await expect(page.getByTestId('reconciliation-table')).toBeVisible();
  await expect(page.locator('[data-testid^="reconciliation-row-"]')).toHaveCount(3);
  await expect(page.getByTestId(`reconciliation-row-${paymentIntentId}`)).toContainText('支付意图');
  await expect(page.getByTestId(`reconciliation-row-${settlementIntentId}`)).toContainText('支付结算');
  await expect(page.getByTestId(`reconciliation-row-${refundIntentId}`)).toContainText('迟到支付退款');
  await expectNoHorizontalOverflow(page);
  await expectNoRestrictedValues(page);

  await confirmReconcile(page, paymentIntentId);
  await expect(page.getByText('对账已受理，仍待支付渠道确认')).toBeVisible();
  await expect(page.getByTestId(`reconciliation-row-${paymentIntentId}`)).toBeVisible();
  await confirmReconcile(page, paymentIntentId);
  await expect(page.getByText('支付事实已完成收敛')).toBeVisible();
  await expect(page.getByTestId(`reconciliation-row-${paymentIntentId}`)).toHaveCount(0);
  expect(backend.reconcileCalls).toHaveLength(2);
  expect(backend.reconcileCalls[0]?.headers['idempotency-key'])
    .not.toBe(backend.reconcileCalls[1]?.headers['idempotency-key']);
  await expectNoHorizontalOverflow(page);
  await expectNoRestrictedValues(page);
});

test('ADM-10 exposes stable slow loading and empty states', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminReconciliationBackend();
  backend.nextListDelayMs = 350;
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);

  await expect(page.getByTestId('reconciliation-loading')).toBeVisible();
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();
  backend.tasks = [];
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('reconciliation-empty')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('ADM-10 keeps 403, 429, 500 and malformed sensitive responses closed', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminReconciliationBackend();
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  backend.nextListFailure = { code: 'FORBIDDEN', message: restrictedValues[0], status: 403 };
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('reconciliation-error')).toContainText('当前账号无权查看支付对账待办');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  backend.nextListFailure = {
    code: 'RATE_LIMITED',
    message: restrictedValues[1],
    retryAfterSeconds: 17,
    status: 429,
  };
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('reconciliation-error')).toContainText('17 秒后重试');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  backend.nextListFailure = { code: 'INTERNAL_ERROR', message: restrictedValues.join(' '), status: 500 };
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('reconciliation-error')).toContainText('支付对账待办加载失败');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  backend.nextListPayload = success({
    items: [{ ...backend.tasks[0], provider_payload: restrictedValues[1] }],
    pagination: { page: 1, page_size: 20, total: 1 },
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('reconciliation-error')).toContainText('响应无法验证');
  await expectNoRestrictedValues(page);
  await expectNoHorizontalOverflow(page);
});

test('ADM-10 redirects to login when list authentication and refresh both fail', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminReconciliationBackend();
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  backend.refreshFailure = true;
  backend.nextListFailure = { code: 'AUTH_EXPIRED', message: 'expired', status: 401 };
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '登录总部管理后台' })).toBeVisible();
});

test('ADM-10 refreshes on 409 and requires a new deliberate action', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminReconciliationBackend();
  backend.reconcilePlan.push({
    bumpVersion: true,
    code: 'PAYMENT_RESULT_CONFLICT',
    kind: 'FAILURE',
    status: 409,
  });
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();
  const initialListCalls = backend.listCalls.length;

  await confirmReconcile(page, paymentIntentId);
  await expect(page.getByText('待办状态已变化，已刷新数据，请重新确认后触发')).toBeVisible();
  await expect(page.getByTestId(`reconciliation-row-${paymentIntentId}`)).toContainText('v3');
  expect(backend.listCalls).toHaveLength(initialListCalls + 1);
  expect(backend.reconcileCalls).toHaveLength(1);
  await page.waitForTimeout(150);
  expect(backend.reconcileCalls).toHaveLength(1);
  await expect(page.getByTestId(`reconcile-${paymentIntentId}`)).toContainText('触发对账');
});

test('ADM-10 locks duplicate clicks and reuses a key only after network loss', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The state matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminReconciliationBackend();
  backend.reconcilePlan.push(
    { kind: 'ABORT' },
    { kind: 'PENDING' },
    { delayMs: 300, kind: 'PENDING' },
  );
  await backend.install(page);
  await signIn(page);
  await openReconciliation(page);
  await expect(page.getByTestId('reconciliation-table')).toBeVisible();

  await confirmReconcile(page, paymentIntentId);
  await expect(page.getByTestId(`reconcile-${paymentIntentId}`)).toContainText('重试确认');
  await confirmReconcile(page, paymentIntentId);
  await expect(page.getByText('对账已受理，仍待支付渠道确认')).toBeVisible();
  expect(backend.reconcileCalls[0]?.headers['idempotency-key'])
    .toBe(backend.reconcileCalls[1]?.headers['idempotency-key']);

  await confirmReconcile(page, paymentIntentId);
  const action = page.getByTestId(`reconcile-${paymentIntentId}`);
  await expect(action).toBeDisabled();
  expect(backend.reconcileCalls).toHaveLength(3);
  await expect(action).toBeEnabled();
  expect(backend.reconcileCalls).toHaveLength(3);
  expect(backend.reconcileCalls[2]?.headers['idempotency-key'])
    .not.toBe(backend.reconcileCalls[1]?.headers['idempotency-key']);
  await expect(page.getByTestId(`reconciliation-row-${paymentIntentId}`)).toContainText('3 次');
});
