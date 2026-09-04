import { expect, test, type Page, type Route } from '@playwright/test';

const ACCESS_TOKEN = ['access', 'b12', 'admin'].join('-');
const REFRESH_TOKEN = ['refresh', 'b12', 'admin'].join('-');
const PREAUTH_TOKEN = ['preauth', 'b12', 'admin'].join('-');
const ACCOUNT_ID = '01J10000000000000000000000';
const SESSION_ID = '01J20000000000000000000000';
const CUSTOMER_ID = '01J30000000000000000000000';
const PRODUCT_ID = '01J40000000000000000000000';
const SKU_ID = '01J50000000000000000000000';
const ORDER_ID = '01J60000000000000000000000';
const ORDER_ITEM_ID = '01J70000000000000000000000';
const AFTERSALE_ID = '01J80000000000000000000000';
const AFTERSALE_ITEM_ID = '01J90000000000000000000000';
const FILE_ID = '01JA0000000000000000000000';
const REFUND_ID = '01JB0000000000000000000000';
const COMPENSATION_ID = '01JC0000000000000000000000';
const ADDRESS_VERSION_ID = '01JD0000000000000000000000';
const RECOVERED_REFUND_ID = '01JE0000000000000000000000';
const UPLOADED_FILE_ID = '01JF0000000000000000000000';
const PREVIEW_TOKEN = 'preview_token_b12_admin_controlled';
const RAW_PHONE = ['100', ' 0000 ', '0000'].join('');
const RAW_ADDRESS = 'B12 controlled development address';
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
}

type Failure = { code: string; status: 401 | 403 | 404 | 409 | 422 | 429 | 500; retryAfter?: number };
type Step = Failure | { kind: 'ABORT' };

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b12_admin' };
}

function failure(code: string) {
  return { code, message: 'controlled internal detail', request_id: 'req_b12_admin_error' };
}

async function fulfill(route: Route, status: number, payload: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store, private', Pragma: 'no-cache', ...headers },
    status,
  });
}

class MockAdminAftersaleBackend {
  readonly calls: Call[] = [];
  readonly rejectPreviewSteps: Step[] = [];
  readonly rejectConfirmSteps: Step[] = [];
  readonly approveSteps: Step[] = [];
  readonly addressPreviewSteps: Step[] = [];
  readonly addressConfirmSteps: Step[] = [];
  readonly compensationPreviewSteps: Step[] = [];
  readonly compensationConfirmSteps: Step[] = [];
  readonly refundRetrySteps: Step[] = [];
  aftersaleActions: string[] = ['APPROVE', 'REJECT', 'VIEW_ORDER'];
  aftersaleStatus = 'PENDING_REVIEW';
  aftersaleVersion = 4;
  includeFailedRefund = false;
  addressVersion = 2;
  fileDownloadDelayMs = 0;
  orderActions: string[] = ['MANUAL_COMPENSATION'];
  orderRefundAttempts: Array<Record<string, unknown>> = [];
  nextListStep: Step | null = null;
  nextDetailStep: Step | null = null;
  listDelayOnceMs = 0;
  refreshFails = false;
  uploadDigest: string | null = null;
  uploadPutCount = 0;
  uploadPutRejectOnce = false;

  async install(page: Page): Promise<void> {
    await page.route('https://uploads.example.test/**', async (route) => {
      const request = route.request();
      this.uploadPutCount += 1;
      expect(request.method()).toBe('PUT');
      expect(request.headers()['content-type']).toBe('image/png');
      expect(request.headers()['x-amz-meta-sha256']).toBe(this.uploadDigest);
      if (this.uploadPutRejectOnce) {
        this.uploadPutRejectOnce = false;
        await route.fulfill({ status: 503 });
        return;
      }
      await route.fulfill({ status: 200 });
    });
    await page.route('**/api/v1/**', (route) => this.handle(route));
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

  private async applyStep(route: Route, step: Step): Promise<void> {
    if ('kind' in step) {
      await route.abort('connectionreset');
      return;
    }
    await fulfill(
      route,
      step.status,
      failure(step.code),
      step.retryAfter === undefined ? {} : { 'Retry-After': String(step.retryAfter) },
    );
  }

  private session() {
    return {
      access_token: ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      assurance: 'MFA',
      expires_at: '2099-09-01T12:00:00.000Z',
      mfa_required: false,
      refresh_token: REFRESH_TOKEN,
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      session_id: SESSION_ID,
    };
  }

  private listItem() {
    return {
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      agent_id: null,
      created_at: '2099-09-01T02:00:00.000Z',
      customer_alias: 'Development customer',
      customer_id: CUSTOMER_ID,
      order_id: ORDER_ID,
      requested_amount: '39.00',
      status: this.aftersaleStatus,
      type: 'REFUND_ONLY',
      version: this.aftersaleVersion,
    };
  }

  private aftersaleDetail() {
    return {
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      application_evidence_file_ids: [FILE_ID],
      available_actions: this.aftersaleActions,
      commission_impact: [],
      created_at: '2099-09-01T02:00:00.000Z',
      customer: {
        customer_alias: 'Development customer',
        customer_id: CUSTOMER_ID,
        nickname_masked: 'D***',
        phone_masked: '[masked phone]',
      },
      errors: [],
      inspection: null,
      inventory_impact: [],
      items: [{
        aftersale_item_id: AFTERSALE_ITEM_ID,
        allocated_amount: '39.00',
        approved_refund_quantity: null,
        order_item_id: ORDER_ITEM_ID,
        product_name: 'B12 Development product',
        refunded_quantity: 0,
        requested_quantity: 1,
        reserved_amount: this.aftersaleStatus === 'REJECTED' ? '0.00' : '39.00',
        reserved_quantity: this.aftersaleStatus === 'REJECTED' ? 0 : 1,
        sku_name: 'Standard',
      }],
      order: {
        order_id: ORDER_ID,
        order_no: `QX${ORDER_ID}`,
        state: {
          close_reason: null,
          completion_reason: 'CUSTOMER_CONFIRMED',
          display_status: '已完成',
          fulfillment_status: 'DELIVERED',
          order_status: 'COMPLETED',
          payment_resolution: 'NORMAL',
          payment_status: 'PAID',
          refund_processing_status: 'IDLE',
          refund_progress_status: 'NONE',
        },
      },
      reason: 'Development reason',
      refund_attempts: this.includeFailedRefund ? [this.refundAttempt()] : [],
      return_address_snapshot: null,
      return_shipment: null,
      status: this.aftersaleStatus,
      timeline: [],
      type: 'REFUND_ONLY',
      version: this.aftersaleVersion,
    };
  }

  private aftersaleCommand() {
    return {
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      inspection: null,
      items: [{
        aftersale_item_id: AFTERSALE_ITEM_ID,
        allocated_amount: '39.00',
        approved_refund_qty: null,
        order_item_id: ORDER_ITEM_ID,
        quantity: 1,
        reserved_amount: '0.00',
        reserved_quantity: 0,
      }],
      order_id: ORDER_ID,
      refund_id: null,
      status: this.aftersaleStatus,
      type: 'REFUND_ONLY',
      version: this.aftersaleVersion,
    };
  }

  private refundAttempt() {
    return {
      amount: '39.00',
      attempt_no: 1,
      created_at: '2099-09-01T02:01:00.000Z',
      last_error: {
        error_code: 'PROVIDER_REJECTED',
        message: 'Controlled provider failure',
        occurred_at: '2099-09-01T02:02:00.000Z',
        retryable: true,
      },
      origin_type: 'AFTERSALE',
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      status: 'FAILED',
      updated_at: '2099-09-01T02:02:00.000Z',
    };
  }

  private refund() {
    return {
      amount: '39.00',
      items: [{
        aftersale_item_id: AFTERSALE_ITEM_ID,
        order_item_id: ORDER_ITEM_ID,
        quantity: 1,
        server_allocated_amount: '39.00',
      }],
      origin_type: 'AFTERSALE',
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      status: 'PENDING',
    };
  }

  private preview(resourceVersion = this.aftersaleVersion) {
    return {
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2099-09-01T02:10:00.000Z',
      impact: {
        affected_count: 1,
        metrics: [{ after: 'REJECTED', before: 'PENDING_REVIEW', key: 'status', label: '状态' }],
        warnings: ['将释放售后额度'],
      },
      preview_token: PREVIEW_TOKEN,
      resource_etag: `"${resourceVersion}"`,
    };
  }

  private address() {
    return {
      city: 'Development city',
      detail_masked: 'Development ***',
      district: 'Development district',
      effective_at: '2099-09-01T02:00:00.000Z',
      phone_masked: '[masked phone]',
      province: 'Development province',
      recipient_name: 'Development recipient',
      version: this.addressVersion,
      version_id: ADDRESS_VERSION_ID,
      version_no: this.addressVersion,
    };
  }

  private orderListItem() {
    return {
      agent_id: null,
      agent_name: null,
      created_at: '2099-09-01T01:00:00.000Z',
      customer_alias: 'Development customer',
      customer_id: CUSTOMER_ID,
      display_status: '已完成',
      fulfillment_status: 'DELIVERED',
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: 'COMPLETED',
      payable_amount: '39.00',
      payment_status: 'PAID',
      recipient_phone_masked: '[masked phone]',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      version: 5,
    };
  }

  private orderDetail() {
    return {
      aftersales: [],
      amounts: { goods: '39.00', paid: '39.00', payable: '39.00', refunded: '0.00', shipping: '0.00' },
      attribution: { agent_id: null, agent_name: null, frozen_at: null, source: 'DIRECT' },
      available_actions: this.orderActions,
      close_reason: null,
      commission_impact: [],
      completion_reason: 'CUSTOMER_CONFIRMED',
      customer: {
        customer_alias: 'Development customer', customer_id: CUSTOMER_ID,
        nickname_masked: 'D***', phone_masked: '[masked phone]',
      },
      display_status: '已完成',
      errors: [],
      fulfillment_status: 'DELIVERED',
      inventory_impact: [],
      items: [{
        line_amount: '39.00', order_item_id: ORDER_ITEM_ID, product_id: PRODUCT_ID,
        product_name: 'B12 Development product', quantity: 1, refunded_quantity: 0,
        reserved_aftersale_quantity: 0, shipped_quantity: 1, sku_id: SKU_ID,
        sku_name: 'Standard', unit_price: '39.00',
      }],
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: 'COMPLETED',
      packages: [],
      pay_expires_at: '2099-09-01T01:30:00.000Z',
      payment_attempts: [],
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_attempts: this.orderRefundAttempts,
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      shipping_address_masked: {
        detail_masked: 'Development ***', phone_masked: '[masked phone]',
        recipient_name_masked: 'D***', region_summary: 'Development region',
      },
      timeline: [{
        axis: 'ORDER', event: 'ORDER_COMPLETED', event_id: `${ORDER_ID}:completed`,
        from_status: 'SHIPPING', occurred_at: '2099-09-01T01:00:00.000Z', to_status: 'COMPLETED',
      }],
      version: 5,
    };
  }

  private compensation(amount: string) {
    return {
      amount,
      commission_reversal: '0.00',
      compensation_id: COMPENSATION_ID,
      compensation_no: `CP${COMPENSATION_ID}`,
      order_id: ORDER_ID,
      order_item_id: ORDER_ITEM_ID,
      origin_type: 'MANUAL_COMPENSATION',
      refunded_amount: '0.00',
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      reserved_amount: amount,
      status: 'PENDING',
      version: 1,
    };
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);

    if (call.path === '/api/v1/admin/auth/login' && call.method === 'POST') {
      await fulfill(route, 200, success({
        assurance: 'PASSWORD_ONLY', challenge_id: 'b12-admin-login',
        expires_at: '2099-09-01T01:05:00.000Z', mfa_required: true,
        next_action: 'VERIFY_TOTP', pre_auth_token: PREAUTH_TOKEN,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/auth/mfa/challenges/b12-admin-login/verify') {
      expect(call.headers.authorization).toBe(`Bearer ${PREAUTH_TOKEN}`);
      await fulfill(route, 200, success(this.session()));
      return;
    }
    if (call.path === '/api/v1/admin/auth/refresh') {
      await fulfill(route, this.refreshFails ? 401 : 200, this.refreshFails ? failure('AUTH_EXPIRED') : success(this.session()));
      return;
    }

    expect(call.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    if (call.path === '/api/v1/admin/auth/logout' && call.method === 'POST') {
      await fulfill(route, 200, success({
        occurred_at: '2099-09-01T02:03:00.000Z',
        resource_id: SESSION_ID,
        resource_type: 'session',
        status: 'REVOKED',
        version: 4,
      }));
      return;
    }
    if (call.path === '/api/v1/files/upload-intents' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.body).toMatchObject({
        filename: expect.any(String),
        mime_type: 'image/png',
        purpose: 'AFTERSALE_EVIDENCE',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: PNG_BYTES.byteLength,
      });
      this.uploadDigest = String(call.body?.sha256);
      await fulfill(route, 200, success({
        expires_at: '2099-09-01T02:08:00.000Z',
        file_id: UPLOADED_FILE_ID,
        purpose: 'AFTERSALE_EVIDENCE',
        status: 'PENDING',
        upload_headers: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'x-amz-meta-sha256', value: this.uploadDigest },
        ],
        upload_url: `https://uploads.example.test/${UPLOADED_FILE_ID}`,
      }));
      return;
    }
    if (call.path === `/api/v1/files/${UPLOADED_FILE_ID}/complete` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.body).toEqual({ sha256: this.uploadDigest, size: PNG_BYTES.byteLength });
      await fulfill(route, 200, success({
        completed_at: '2099-09-01T02:04:00.000Z',
        file_id: UPLOADED_FILE_ID,
        public_url: null,
        purpose: 'AFTERSALE_EVIDENCE',
        status: 'READY',
      }));
      return;
    }
    if (call.path === `/api/v1/files/${FILE_ID}/download-url` && call.method === 'GET') {
      if (this.fileDownloadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.fileDownloadDelayMs));
      }
      await fulfill(route, 200, success({
        download_url: 'https://storage.example.test/private/evidence',
        expires_at: '2099-09-01T02:08:00.000Z',
        file_id: FILE_ID,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/brands' && call.method === 'GET') {
      await fulfill(route, 200, success({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }));
      return;
    }
    if (call.path === '/api/v1/admin/auth/current' && call.method === 'GET') {
      await fulfill(route, 200, success({
        account_id: ACCOUNT_ID,
        assurance: 'MFA',
        mfa_verified_at: '2099-09-01T01:00:00.000Z',
        permissions: ['admin:security:read'],
        restriction: 'NONE', role: 'SUPER_ADMIN', session_id: SESSION_ID, status: 'ACTIVE', version: 3,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/aftersales' && call.method === 'GET') {
      if (this.listDelayOnceMs > 0) {
        const delay = this.listDelayOnceMs;
        this.listDelayOnceMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.nextListStep) {
        const current = this.nextListStep;
        this.nextListStep = null;
        await this.applyStep(route, current);
        return;
      }
      await fulfill(route, 200, success({
        items: [this.listItem()], pagination: { page: 1, page_size: 20, total: 1 },
      }));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}` && call.method === 'GET') {
      if (this.nextDetailStep) {
        const current = this.nextDetailStep;
        this.nextDetailStep = null;
        await this.applyStep(route, current);
        return;
      }
      await fulfill(route, 200, success(this.aftersaleDetail()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/reject-preview` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      const step = this.rejectPreviewSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.preview()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/reject` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      const step = this.rejectConfirmSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      this.aftersaleStatus = 'REJECTED';
      this.aftersaleVersion += 1;
      this.aftersaleActions = ['VIEW_ORDER'];
      await fulfill(route, 200, success(this.aftersaleCommand()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/approve` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      const step = this.approveSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.aftersaleCommand()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-inspections` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      await fulfill(route, 200, success(this.aftersaleCommand()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/continue-refund` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      await fulfill(route, 200, success(this.aftersaleCommand()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/reject-preview` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success(this.preview()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/reject` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      await fulfill(route, 200, success(this.aftersaleCommand()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/refund-preview` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success(this.preview()));
      return;
    }
    if (call.path === `/api/v1/admin/aftersales/${AFTERSALE_ID}/refunds` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      await fulfill(route, 200, success(this.refund()));
      return;
    }
    if (call.path === `/api/v1/admin/refunds/${REFUND_ID}/retry-preview` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success(this.preview()));
      return;
    }
    if (call.path === `/api/v1/admin/refunds/${REFUND_ID}/retry` && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      const step = this.refundRetrySteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      expect(call.headers['if-match']).toBe(`"${this.aftersaleVersion}"`);
      await fulfill(route, 200, success(this.refund()));
      return;
    }
    if (call.path === '/api/v1/admin/settings/return-address' && call.method === 'GET') {
      await fulfill(route, 200, success(this.address()));
      return;
    }
    if (call.path === '/api/v1/admin/settings/return-address/preview' && call.method === 'POST') {
      const step = this.addressPreviewSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.preview(this.addressVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/settings/return-address' && call.method === 'PATCH') {
      expect(call.headers['if-match']).toBe(`"${this.addressVersion}"`);
      const step = this.addressConfirmSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      this.addressVersion += 1;
      await fulfill(route, 200, success(this.address()));
      return;
    }
    if (call.path === '/api/v1/admin/orders' && call.method === 'GET') {
      await fulfill(route, 200, success({
        items: [this.orderListItem()], pagination: { page: 1, page_size: 20, total: 1 },
      }));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}` && call.method === 'GET') {
      await fulfill(route, 200, success(this.orderDetail()));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}/manual-compensations/preview` && call.method === 'POST') {
      const step = this.compensationPreviewSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      await fulfill(route, 200, success(this.preview(5)));
      return;
    }
    if (call.path === `/api/v1/admin/orders/${ORDER_ID}/manual-compensations` && call.method === 'POST') {
      expect(call.headers['if-match']).toBe('"5"');
      const step = this.compensationConfirmSteps.shift();
      if (step) {
        await this.applyStep(route, step);
        return;
      }
      await fulfill(route, 201, success(this.compensation(String(call.body?.amount))));
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE'));
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('超级管理员账号').fill('b12.admin');
  await page.getByLabel('登录密码').fill(['Runtime', 'Password', 'B12'].join(''));
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

async function openAftersales(page: Page): Promise<void> {
  await page.getByTitle('售后管理').click();
  await expect(page).toHaveURL(/\/aftersales$/);
  await expect(page.getByTestId(`open-aftersale-${AFTERSALE_ID}`)).toBeVisible();
}

async function openAftersaleDetail(page: Page): Promise<void> {
  await page.getByTestId(`open-aftersale-${AFTERSALE_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/aftersales/${AFTERSALE_ID}$`));
  await expect(page.getByTestId('admin-aftersale-detail-content')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        className: element.className.toString().slice(0, 120),
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName,
      }))
      .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
      .slice(0, 8),
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders))
    .toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

function stateMatrix(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

test('ADM-12/13 lists, previews and rejects an aftersale at every viewport', async ({ page }) => {
  const backend = new MockAdminAftersaleBackend();
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await expectNoHorizontalOverflow(page);
  await openAftersaleDetail(page);
  await expect(page.getByTestId('admin-aftersale-reject')).toBeVisible();
  await expect(page.getByTestId('admin-aftersale-approve')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByTestId('admin-aftersale-reject').click();
  await page.getByLabel('操作原因').fill('申请事实与服务端核验结果不一致');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('aftersale-command-preview')).toBeVisible();
  await page.getByTestId('aftersale-command-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByTestId('admin-aftersale-actions')).toContainText('已拒绝');
  await expect(page.getByTestId('admin-aftersale-reject')).toHaveCount(0);

  const previewCall = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject-preview`, 'POST')[0];
  const confirmCalls = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject`, 'POST');
  expect(confirmCalls).toHaveLength(1);
  expect(previewCall?.headers['idempotency-key']).not.toBe(confirmCalls[0]?.headers['idempotency-key']);
  expect(confirmCalls[0]?.body).toMatchObject({
    confirmation_hash: 'a'.repeat(64), preview_token: PREVIEW_TOKEN,
  });
  await expectNoHorizontalOverflow(page);
});

test('ADM-12/13 treats available_actions as authoritative and closes read failures', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 Admin read matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.aftersaleActions = ['VIEW_ORDER'];
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await openAftersaleDetail(page);
  await expect(page.getByTestId('admin-aftersale-view-order')).toBeVisible();
  await expect(page.getByTestId('admin-aftersale-reject')).toHaveCount(0);
  await expect(page.getByTestId('admin-aftersale-approve')).toHaveCount(0);

  for (const step of [
    { code: 'FORBIDDEN', status: 403 as const },
    { code: 'RATE_LIMITED', status: 429 as const, retryAfter: 6 },
    { code: 'INTERNAL_ERROR', status: 500 as const },
    { kind: 'ABORT' as const },
  ]) {
    backend.nextDetailStep = step;
    await page.getByTestId('admin-aftersale-refresh').click();
    await expect(page.getByTestId('admin-aftersale-detail-error')).toBeVisible();
    await expect(page.getByTestId('admin-aftersale-actions')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('admin-aftersale-detail-content')).toBeVisible();
  }

  backend.refreshFails = true;
  backend.nextDetailStep = { code: 'AUTH_EXPIRED', status: 401 };
  await page.getByTestId('admin-aftersale-refresh').click();
  await expect(page).toHaveURL(/\/login$/);
});

test('ADM-12 aborts private evidence capabilities across route and session boundaries', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The private evidence lifecycle runs at 390 and 1024 widths.');
  await page.addInitScript(() => {
    const openedEvidenceUrls: string[] = [];
    Object.defineProperty(window, '__b12OpenedEvidenceUrls', { value: openedEvidenceUrls });
    HTMLAnchorElement.prototype.click = function click() {
      openedEvidenceUrls.push(this.href);
    };
  });
  const backend = new MockAdminAftersaleBackend();
  backend.fileDownloadDelayMs = 300;
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await openAftersaleDetail(page);

  await page.getByTestId('admin-aftersale-application-evidence-0').click();
  await expect.poll(() => backend.callsFor(`/api/v1/files/${FILE_ID}/download-url`, 'GET').length).toBe(1);
  await page.getByTestId('admin-aftersale-back').click();
  await expect(page).toHaveURL(/\/aftersales$/);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __b12OpenedEvidenceUrls: string[] })
    .__b12OpenedEvidenceUrls)).toEqual([]);

  await openAftersaleDetail(page);
  await page.getByTestId('admin-aftersale-application-evidence-0').click();
  await expect.poll(() => backend.callsFor(`/api/v1/files/${FILE_ID}/download-url`, 'GET').length).toBe(2);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __b12OpenedEvidenceUrls: string[] })
    .__b12OpenedEvidenceUrls)).toEqual([]);
});

test('ADM-13 keeps rejected evidence uploads out of inspection and submits a verified retry', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The evidence upload lifecycle runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.aftersaleActions = ['RECORD_INSPECTION', 'VIEW_ORDER'];
  backend.uploadPutRejectOnce = true;
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await openAftersaleDetail(page);

  await page.getByTestId('admin-aftersale-record_inspection').click();
  const dialog = page.getByTestId('aftersale-command-record_inspection');
  const fileInput = dialog.locator('input[type="file"]');
  await fileInput.setInputFiles({ buffer: PNG_BYTES, mimeType: 'image/png', name: 'rejected-evidence.png' });
  await expect(dialog.getByRole('alert').filter({ hasText: '验货证据上传失败' })).toBeVisible();
  expect(backend.callsFor(`/api/v1/files/${UPLOADED_FILE_ID}/complete`, 'POST')).toHaveLength(0);

  await fileInput.setInputFiles({ buffer: PNG_BYTES, mimeType: 'image/png', name: 'verified-evidence.png' });
  await expect(dialog.getByText('verified-evidence.png', { exact: true })).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('退货验收已封存', { exact: true })).toBeVisible();

  expect(backend.uploadPutCount).toBe(2);
  expect(backend.callsFor('/api/v1/files/upload-intents', 'POST')).toHaveLength(2);
  expect(backend.callsFor(`/api/v1/files/${UPLOADED_FILE_ID}/complete`, 'POST')).toHaveLength(1);
  expect(backend.callsFor(
    `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-inspections`,
    'POST',
  )[0]?.body).toMatchObject({ evidence_file_ids: [UPLOADED_FILE_ID], result: 'PASS' });
});

test('ADM-13 executes every server-authorized review, inspection and refund action', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The complete B12 Admin action matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.aftersaleActions = [
    'APPROVE',
    'RECORD_INSPECTION',
    'CONTINUE_REFUND',
    'REJECT_AFTER_RETURN',
    'CREATE_REFUND',
    'RETRY_REFUND',
    'VIEW_ORDER',
  ];
  backend.includeFailedRefund = true;
  backend.approveSteps.push({ kind: 'ABORT' });
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await openAftersaleDetail(page);

  await page.getByTestId('admin-aftersale-approve').click();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('售后初审已通过', { exact: true })).toBeVisible();
  const approveCalls = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/approve`, 'POST');
  expect(approveCalls).toHaveLength(2);
  expect(approveCalls[0]?.headers['idempotency-key']).toBe(approveCalls[1]?.headers['idempotency-key']);

  await page.getByTestId('admin-aftersale-record_inspection').click();
  await expect(page.getByText('数量等式校验通过', { exact: true })).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('退货验收已封存', { exact: true })).toBeVisible();
  const inspectionCall = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/return-inspections`, 'POST')[0];
  expect(inspectionCall?.body).toMatchObject({
    evidence_file_ids: [],
    items: [{
      approved_refund_qty: 1,
      damaged_qty: 0,
      order_item_id: ORDER_ITEM_ID,
      received_qty: 1,
      restock_qty: 1,
      return_to_customer_qty: 0,
      scrap_qty: 0,
    }],
    result: 'PASS',
  });

  await page.getByTestId('admin-aftersale-continue_refund').click();
  await page.getByLabel('操作原因').fill('验货事实满足继续退款条件');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('已继续退款流程', { exact: true })).toBeVisible();
  expect(backend.callsFor(
    `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/continue-refund`,
    'POST',
  )[0]?.body).toMatchObject({ reason: '验货事实满足继续退款条件', resolution: 'CONTINUE_REFUND' });

  await page.getByTestId('admin-aftersale-reject_after_return').click();
  await page.getByLabel('操作原因').fill('验货结果不满足退款条件');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('aftersale-command-preview')).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('售后处置已完成', { exact: true })).toBeVisible();

  await page.getByTestId('admin-aftersale-create_refund').click();
  await page.getByLabel('操作原因').fill('根据已批准数量创建普通退款');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('aftersale-command-preview')).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('退款已创建并进入处理', { exact: true })).toBeVisible();
  expect(backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/refunds`, 'POST')[0]?.body).toMatchObject({
    confirmation_hash: 'a'.repeat(64),
    items: [{ aftersale_item_id: AFTERSALE_ITEM_ID, quantity: 1 }],
    preview_token: PREVIEW_TOKEN,
  });

  await page.getByTestId('admin-aftersale-retry_refund').click();
  await expect(page).toHaveURL(new RegExp(`/orders/${ORDER_ID}$`));
  await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();
  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry-preview`, 'POST')).toHaveLength(0);
  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry`, 'POST')).toHaveLength(0);

  for (const [previewPath, confirmPath] of [
    [
      `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/reject-preview`,
      `/api/v1/admin/aftersales/${AFTERSALE_ID}/return-resolution/reject`,
    ],
    [
      `/api/v1/admin/aftersales/${AFTERSALE_ID}/refund-preview`,
      `/api/v1/admin/aftersales/${AFTERSALE_ID}/refunds`,
    ],
  ]) {
    const previewCall = backend.callsFor(previewPath, 'POST')[0];
    const confirmCall = backend.callsFor(confirmPath, 'POST')[0];
    expect(previewCall?.headers['idempotency-key']).not.toBe(confirmCall?.headers['idempotency-key']);
    expect(confirmCall?.body).toMatchObject({ confirmation_hash: 'a'.repeat(64), preview_token: PREVIEW_TOKEN });
  }
  await expectNoHorizontalOverflow(page);
});

test('ADM-13 refreshes conflicts and keeps 422/429/500 outcomes closed', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 Admin command matrix runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.rejectPreviewSteps.push(
    { code: 'AFTERSALE_QUOTA_EXCEEDED', status: 422 },
    { code: 'RATE_LIMITED', status: 429, retryAfter: 9 },
    { kind: 'ABORT' },
  );
  await backend.install(page);
  await signIn(page);
  await openAftersales(page);
  await openAftersaleDetail(page);

  await page.getByTestId('admin-aftersale-reject').click();
  await page.getByLabel('操作原因').fill('本次售后不满足处理条件');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByRole('alert')).toContainText('可退款数量或金额已变化');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByRole('alert')).toContainText('9 秒后重试');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByRole('alert')).toContainText('无法安全重放');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('aftersale-command-preview')).toBeVisible();

  const previewCalls = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject-preview`, 'POST');
  expect(previewCalls).toHaveLength(4);
  expect(new Set(previewCalls.map(({ headers }) => headers['idempotency-key'])).size).toBe(4);

  backend.rejectConfirmSteps.push({ code: 'RESOURCE_VERSION_CONFLICT', status: 409 });
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('admin-aftersale-detail-content')).toBeVisible();
  await expect(page.getByText(/已刷新最新投影/, { exact: false })).toBeVisible();

  await page.getByTestId('admin-aftersale-reject').click();
  await page.getByLabel('操作原因').fill('本次售后不满足处理条件');
  await page.getByTestId('aftersale-command-submit').click();
  backend.rejectConfirmSteps.push({ code: 'INTERNAL_ERROR', status: 500 });
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('admin-aftersale-actions')).toContainText('已拒绝');
  const confirmCalls = backend.callsFor(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject`, 'POST');
  expect(confirmCalls.at(-2)?.headers['idempotency-key']).toBe(confirmCalls.at(-1)?.headers['idempotency-key']);
  await expectNoHorizontalOverflow(page);
});

test('ADM-16 publishes a return-address version without persisting plaintext at every viewport', async ({ page }) => {
  const backend = new MockAdminAftersaleBackend();
  backend.addressPreviewSteps.push({ kind: 'ABORT' });
  await backend.install(page);
  await signIn(page);
  const accountLink = page.getByRole('link', { name: '账户安全', exact: true });
  await expect(accountLink).toBeVisible();
  await accountLink.scrollIntoViewIfNeeded();
  const accountBox = await accountLink.boundingBox();
  const viewport = page.viewportSize();
  expect(accountBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect((accountBox?.y ?? 0) + (accountBox?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  await accountLink.click();
  await expect(page.getByTestId('return-address-panel')).toBeVisible();
  await page.getByRole('button', { name: '发布新版本' }).click();

  await page.getByLabel('收件人').fill('Development recipient');
  await page.getByTestId('return-address-phone').fill(RAW_PHONE);
  await page.getByLabel('省').fill('Development province');
  await page.getByLabel('市').fill('Development city');
  await page.getByLabel('区 / 县').fill('Development district');
  await page.getByTestId('return-address-detail').fill(RAW_ADDRESS);
  await page.getByLabel('发布原因（2-500 字符）').fill('更新脱敏开发环境退货地址');
  await page.getByTestId('return-address-preview-submit').click();
  await expect(page.getByText('预览结果无法安全重放，请重新生成预览', { exact: true })).toBeVisible();
  await page.getByTestId('return-address-preview-submit').click();
  await expect(page.getByTestId('return-address-preview')).toBeVisible();
  await page.getByTestId('return-address-confirm-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByText('版本 3', { exact: false })).toBeVisible();

  const previewCalls = backend.callsFor('/api/v1/admin/settings/return-address/preview', 'POST');
  const confirmCalls = backend.callsFor('/api/v1/admin/settings/return-address', 'PATCH');
  expect(previewCalls).toHaveLength(2);
  expect(confirmCalls).toHaveLength(1);
  expect(previewCalls[0]?.headers['idempotency-key']).not.toBe(previewCalls[1]?.headers['idempotency-key']);
  expect(previewCalls[1]?.headers['idempotency-key']).not.toBe(confirmCalls[0]?.headers['idempotency-key']);
  expect(confirmCalls[0]?.body).toMatchObject({
    confirmation_hash: 'a'.repeat(64), preview_token: PREVIEW_TOKEN,
  });
  const persisted = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(persisted).not.toContain(RAW_PHONE);
  expect(persisted).not.toContain(RAW_ADDRESS);
  expect(persisted).not.toContain(PREVIEW_TOKEN);
  await expectNoHorizontalOverflow(page);
});

test('ADM-13 manual compensation uses a separate preview and confirm fact', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The B12 compensation flow runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.compensationPreviewSteps.push({ kind: 'ABORT' });
  backend.compensationConfirmSteps.push({ kind: 'ABORT' });
  await backend.install(page);
  await signIn(page);
  await page.getByTitle('订单中心').click();
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await expect(page.getByTestId('admin-order-manual-compensation')).toBeVisible();
  await page.getByTestId('admin-order-manual-compensation').click();

  await page.getByPlaceholder('0.01').fill('9999999999999999.99');
  const compensationReason = '验证契约上界金额仍可进入补偿预览';
  await page.getByLabel('操作原因').fill(compensationReason);
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('预览结果无法安全重放，请重新生成预览', { exact: true })).toBeVisible();
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByTestId('order-refund-command-preview')).toBeVisible();
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
  const pendingStorage = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))));
  expect(pendingStorage).not.toContain(compensationReason);

  await page.goBack();
  await expect(page).toHaveURL(/\/orders$/);
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();

  await page.reload();
  await signIn(page);
  await page.getByTitle('订单中心').click();
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
  const recoveryReason = page.getByTestId('order-refund-command-recovery-reason');
  await expect(recoveryReason).toBeEnabled();
  await recoveryReason.fill('不匹配的补偿原因');
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('输入的原因与上次确认不一致，未发送请求', { exact: true })).toBeVisible();
  expect(backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/manual-compensations`, 'POST')).toHaveLength(1);
  await recoveryReason.fill(compensationReason);
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('金额补偿已创建并进入退款处理', { exact: true })).toBeVisible();

  const previewCalls = backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/manual-compensations/preview`, 'POST');
  const confirmCalls = backend.callsFor(`/api/v1/admin/orders/${ORDER_ID}/manual-compensations`, 'POST');
  expect(previewCalls).toHaveLength(2);
  expect(confirmCalls).toHaveLength(2);
  expect(previewCalls[0]?.headers['idempotency-key']).not.toBe(previewCalls[1]?.headers['idempotency-key']);
  expect(previewCalls[1]?.headers['idempotency-key']).not.toBe(confirmCalls[0]?.headers['idempotency-key']);
  expect(confirmCalls[0]?.headers['idempotency-key']).toBe(confirmCalls[1]?.headers['idempotency-key']);
  expect(confirmCalls[0]?.body).toEqual(confirmCalls[1]?.body);
  expect(confirmCalls[0]?.body).toMatchObject({ amount: '9999999999999999.99', order_item_id: ORDER_ITEM_ID });
  await expectNoHorizontalOverflow(page);
});

test('ADM-13 retries only a refund whose own latest attempt is failed', async ({ page }, testInfo) => {
  test.skip(!stateMatrix(testInfo.project.name), 'The multi-refund retry projection runs at 390 and 1024 widths.');
  const backend = new MockAdminAftersaleBackend();
  backend.orderActions = ['RETRY_REFUND'];
  backend.orderRefundAttempts = [
    {
      amount: '10.00', attempt_no: 1, created_at: '2099-09-01T01:01:00.000Z',
      last_error: {
        error_code: 'PROVIDER_REJECTED', message: 'Controlled retryable failure',
        occurred_at: '2099-09-01T01:02:00.000Z', retryable: true,
      },
      origin_type: 'AFTERSALE', refund_id: REFUND_ID, refund_no: `RF${REFUND_ID}`,
      status: 'FAILED', updated_at: '2099-09-01T01:02:00.000Z',
    },
    {
      amount: '29.00', attempt_no: 1, created_at: '2099-09-01T01:03:00.000Z',
      last_error: {
        error_code: 'PROVIDER_REJECTED', message: 'Controlled recovered failure',
        occurred_at: '2099-09-01T01:04:00.000Z', retryable: true,
      },
      origin_type: 'AFTERSALE', refund_id: RECOVERED_REFUND_ID,
      refund_no: `RF${RECOVERED_REFUND_ID}`, status: 'FAILED', updated_at: '2099-09-01T01:04:00.000Z',
    },
    {
      amount: '29.00', attempt_no: 2, created_at: '2099-09-01T01:05:00.000Z', last_error: null,
      origin_type: 'AFTERSALE', refund_id: RECOVERED_REFUND_ID,
      refund_no: `RF${RECOVERED_REFUND_ID}`, status: 'SUCCEEDED', updated_at: '2099-09-01T01:06:00.000Z',
    },
  ];
  backend.refundRetrySteps.push({ kind: 'ABORT' });
  await backend.install(page);
  await signIn(page);
  await page.getByTitle('订单中心').click();
  await page.getByTestId(`admin-order-open-${ORDER_ID}`).click();
  await page.getByTestId('admin-order-retry-refund').click();
  await page.getByLabel('操作原因').fill('仅重试自身最新尝试仍失败的退款');
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByTestId('order-refund-command-preview')).toBeVisible();
  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();

  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry-preview`, 'POST')).toHaveLength(1);
  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry`, 'POST')).toHaveLength(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/orders$/);
  await page.getByTitle('售后管理').click();
  await page.getByTestId(`open-aftersale-${AFTERSALE_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${ORDER_ID}$`));
  await expect(page.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry-preview`, 'POST')).toHaveLength(1);
  expect(backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry`, 'POST')).toHaveLength(1);

  await page.getByTestId('order-refund-command-submit').click();
  await expect(page.getByText('退款重试已提交', { exact: true })).toBeVisible();

  const confirmCalls = backend.callsFor(`/api/v1/admin/refunds/${REFUND_ID}/retry`, 'POST');
  expect(confirmCalls).toHaveLength(2);
  expect(confirmCalls[0]?.headers['idempotency-key']).toBe(confirmCalls[1]?.headers['idempotency-key']);
  expect(confirmCalls[0]?.body).toEqual(confirmCalls[1]?.body);
  expect(backend.callsFor(`/api/v1/admin/refunds/${RECOVERED_REFUND_ID}/retry-preview`, 'POST')).toHaveLength(0);
  expect(backend.callsFor(`/api/v1/admin/refunds/${RECOVERED_REFUND_ID}/retry`, 'POST')).toHaveLength(0);
});
