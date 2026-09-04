import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import type {
  AgentBankAccount,
  AgentCommission,
  AgentCommissionDetail,
  AgentCustomerDetail,
  AgentCustomerListItem,
  AgentOrderDetail,
  AgentOrderListItem,
  AgentProduct,
  AgentPromotion,
  AgentSession,
  AgentWithdrawal,
  RestrictedAgentSession,
} from '../../apps/agent-web/src/types/agent';

const ACCESS_TOKEN = ['access', 'b13', 'agent'].join('-');
const ROTATED_ACCESS_TOKEN = ['access', 'b13', 'agent', 'rotated'].join('-');
const RESTRICTED_TOKEN = ['restricted', 'b13', 'agent'].join('-');
const REFRESH_TOKEN = ['refresh', 'b13', 'agent'].join('-');
const ROTATED_REFRESH_TOKEN = ['refresh', 'b13', 'agent', 'rotated'].join('-');
const ACCOUNT_ID = '01J10000000000000000000000';
const SESSION_ID = '01J20000000000000000000000';
const ROTATED_SESSION_ID = '01J20000000000000000000001';
const AGENT_ID = '01J30000000000000000000000';
const PRODUCT_ID = '01J40000000000000000000000';
const SKU_ID = '01J50000000000000000000000';
const ZERO_SKU_ID = '01J60000000000000000000000';
const CUSTOMER_ID = '01J70000000000000000000000';
const BINDING_ID = '01J80000000000000000000000';
const ORDER_ID = '01J90000000000000000000000';
const ORDER_ITEM_ID = '01JA0000000000000000000000';
const SECOND_ORDER_ITEM_ID = '01JA0000000000000000000001';
const COMMISSION_ID = '01JB0000000000000000000000';
const SECOND_COMMISSION_ID = '01JB0000000000000000000001';
const CANCELLED_COMMISSION_ID = '01JB0000000000000000000002';
const REFUND_COMMISSION_ID = '01JB0000000000000000000003';
const LEDGER_ID = '01JC0000000000000000000000';
const CANCELLED_LEDGER_ID = '01JC0000000000000000000001';
const REFUND_LEDGER_ID = '01JC0000000000000000000002';
const BANK_ACCOUNT_ID = '01JD0000000000000000000000';
const WITHDRAWAL_ID = '01JE0000000000000000000000';
const REJECTED_WITHDRAWAL_ID = '01JF0000000000000000000000';
const PAID_WITHDRAWAL_ID = '01JG0000000000000000000000';
const APPROVED_WITHDRAWAL_ID = '01JG0000000000000000000001';
const PROMOTION_ID = '01JH0000000000000000000000';
const QR_FILE_ID = '01JJ0000000000000000000000';
const PROOF_FILE_ID = '01JK0000000000000000000000';
const CATEGORY_ID = '01JM0000000000000000000000';
const BRAND_ID = '01JN0000000000000000000000';
const SECOND_CATEGORY_ID = '01JM0000000000000000000001';
const SECOND_BRAND_ID = '01JN0000000000000000000001';
const RULE_VERSION_ID = '01JP0000000000000000000000';
const REFUND_ID = '01JS0000000000000000000000';
const RAW_BANK_ACCOUNT = ['6217', '0018', '7654', '3456'].join(' ');
const FULL_PHONE_FIXTURE = ['1380', '0134', '821'].join('');
const NOW = '2099-09-04T02:00:00.000Z';

type FailureStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500;
type PlannedStep =
  | { kind: 'ABORT' }
  | { kind: 'COMMIT_ABORT' }
  | { kind: 'DELAY'; milliseconds: number }
  | { kind: 'DELAY_COMMIT_ABORT'; milliseconds: number }
  | { kind: 'MALFORMED' }
  | { code: string; kind: 'FAILURE'; retryAfterSeconds?: number; status: FailureStatus };

interface RecordedCall {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: URLSearchParams;
}

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b13_agent' };
}

function failure(code: string) {
  return { code, message: 'controlled internal detail', request_id: 'req_b13_agent_error' };
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

function pagination(items: unknown[]) {
  return { items, pagination: { page: 1, page_size: 20, total: items.length } };
}

function fullSession(rotated = false): AgentSession {
  return {
    access_token: rotated ? ROTATED_ACCESS_TOKEN : ACCESS_TOKEN,
    refresh_token: rotated ? ROTATED_REFRESH_TOKEN : REFRESH_TOKEN,
    account_id: ACCOUNT_ID,
    session_id: rotated ? ROTATED_SESSION_ID : SESSION_ID,
    role: 'AGENT_ADMIN',
    mfa_required: false,
    assurance: 'PASSWORD',
    restriction: 'NONE',
    expires_at: '2099-09-04T12:00:00.000Z',
  } as const;
}

function restrictedSession(): RestrictedAgentSession {
  return {
    access_token: RESTRICTED_TOKEN,
    account_id: ACCOUNT_ID,
    session_id: SESSION_ID,
    role: 'AGENT_ADMIN',
    mfa_required: false,
    assurance: 'PASSWORD',
    restriction: 'CHANGE_PASSWORD_ONLY',
    must_change_password: true,
    next_action: 'CHANGE_PASSWORD',
    allowed_actions: ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'],
    expires_at: '2099-09-04T02:05:00.000Z',
  } as const;
}

function command(resourceType: string, resourceId = ACCOUNT_ID, version = 2) {
  return {
    resource_type: resourceType,
    resource_id: resourceId,
    status: 'COMPLETED',
    version,
    occurred_at: NOW,
  };
}

function product(): AgentProduct {
  const image = {
    is_primary: true,
    sort_order: 1,
    url: 'https://assets.example.test/b13-product.png',
  };
  return {
    product_id: PRODUCT_ID,
    spu_code: 'B13-SPU-001',
    name: '青序净澈洗护套装',
    subtitle: '日常家庭清洁组合',
    brand: {
      brand_id: BRAND_ID,
      name: '青序生活',
      description: 'Development brand',
      logo_url: null,
      sort_order: 1,
    },
    category: {
      category_id: CATEGORY_ID,
      name: '家庭洗护',
      icon_url: null,
      sort_order: 1,
    },
    primary_image: image,
    images: [image],
    skus: [
      {
        sku_id: SKU_ID,
        code: 'B13-SKU-STD',
        name: '标准装',
        spec_json: { attributes: [{ name: '规格', value: '标准装' }] },
        retail_price: '120.00',
        current_estimated_rate: '5.0000',
        rule_source: 'SKU',
        rule_version_id: RULE_VERSION_ID,
        estimated_commission_per_unit: '6.00',
        commission_label: '预计佣金，以支付时规则为准',
      },
      {
        sku_id: ZERO_SKU_ID,
        code: 'B13-SKU-ZERO',
        name: '试用装',
        spec_json: null,
        retail_price: '20.00',
        current_estimated_rate: '0.0000',
        rule_source: 'PLATFORM',
        rule_version_id: RULE_VERSION_ID,
        estimated_commission_per_unit: '0.00',
        commission_label: '无佣金',
      },
    ],
  };
}

function customerListItem(): AgentCustomerListItem {
  return {
    customer_id: CUSTOMER_ID,
    customer_alias: 'CUST-B13-001',
    nickname_masked: '周**',
    phone_tail: '4821',
    city: '杭州',
    consumption_amount: '360.00',
    consumption_count: 3,
    registered_at: '2099-08-01T02:00:00.000Z',
    last_product_name: '青序净澈洗护套装',
    account_status: 'ACTIVE',
    binding_status: 'BOUND',
    binding_id: BINDING_ID,
    binding_started_at: '2099-08-10T02:00:00.000Z',
  } as const;
}

function customerDetail(): AgentCustomerDetail {
  const item = customerListItem();
  return {
    customer: {
      customer_id: item.customer_id,
      customer_alias: item.customer_alias,
      nickname_masked: item.nickname_masked,
      phone_tail: item.phone_tail,
      city: item.city,
      consumption_amount: item.consumption_amount,
      consumption_count: item.consumption_count,
      registered_at: item.registered_at,
      last_product_name: item.last_product_name,
      binding: {
        binding_id: BINDING_ID,
        customer_id: CUSTOMER_ID,
        agent_id: AGENT_ID,
        agent_name: '青序华东一级代理',
        started_at: item.binding_started_at,
        customer_version: 4,
      },
      version: 4,
    },
    binding_period: {
      binding_id: BINDING_ID,
      started_at: item.binding_started_at,
      ended_at: null,
    },
    orders: [{
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      display_status: '已完成',
      payable_amount: '140.00',
      paid_at: '2099-09-01T01:00:00.000Z',
    }],
    recent_products: [{
      product_id: PRODUCT_ID,
      product_name: '青序净澈洗护套装',
      sku_id: SKU_ID,
      sku_name: '标准装',
      last_purchased_at: '2099-09-01T01:00:00.000Z',
    }],
  };
}

function orderListItem(): AgentOrderListItem {
  return {
    order_id: ORDER_ID,
    order_no: `QX${ORDER_ID}`,
    order_status: 'COMPLETED',
    payment_status: 'PAID',
    refund_progress_status: 'PARTIAL',
    refund_processing_status: 'IDLE',
    fulfillment_status: 'DELIVERED',
    close_reason: null,
    completion_reason: 'CUSTOMER_CONFIRMED',
    payment_resolution: 'NORMAL',
    display_status: '部分退款',
    final_agent_id: AGENT_ID,
    customer_alias: 'CUST-B13-001',
    customer_city: '杭州',
    payable_amount: '140.00',
    items: [
      {
        order_item_id: ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: '青序净澈洗护套装',
        sku_name: '标准装',
        quantity: 1,
        line_amount: '120.00',
      },
      {
        order_item_id: SECOND_ORDER_ITEM_ID,
        product_id: PRODUCT_ID,
        sku_id: ZERO_SKU_ID,
        product_name: '青序净澈洗护套装',
        sku_name: '试用装',
        quantity: 1,
        line_amount: '20.00',
      },
    ],
    aftersale_summary: {
      active_count: 0,
      latest_aftersale_id: null,
      latest_status: null,
      refunded_amount: '20.00',
    },
    available_actions: ['VIEW_DETAIL', 'VIEW_COMMISSION'],
    created_at: '2099-09-01T00:30:00.000Z',
    paid_at: '2099-09-01T01:00:00.000Z',
  } as const;
}

function orderDetail(): AgentOrderDetail {
  const list = orderListItem();
  return {
    order_id: list.order_id,
    order_no: list.order_no,
    order_status: list.order_status,
    payment_status: list.payment_status,
    refund_progress_status: list.refund_progress_status,
    refund_processing_status: list.refund_processing_status,
    fulfillment_status: list.fulfillment_status,
    close_reason: list.close_reason,
    completion_reason: list.completion_reason,
    payment_resolution: list.payment_resolution,
    display_status: list.display_status,
    final_agent_id: AGENT_ID,
    payable_amount: list.payable_amount,
    customer_snapshot: {
      customer_alias: list.customer_alias,
      nickname_masked: '周**',
      phone_tail: '4821',
      city: '杭州',
      address_summary_masked: '浙江省杭州市',
    },
    items: [
      {
        ...list.items[0],
        unit_price: '120.00',
        refunded_quantity: 0,
        reserved_aftersale_quantity: 0,
        shipped_quantity: 1,
      },
      {
        ...list.items[1],
        unit_price: '20.00',
        refunded_quantity: 0,
        reserved_aftersale_quantity: 0,
        shipped_quantity: 1,
      },
    ],
    commission_items: [
      {
        commission_snapshot_id: COMMISSION_ID,
        order_item_id: ORDER_ITEM_ID,
        effective_rate: '5.0000',
        rule_source: 'SKU',
        original_commission: '6.00',
        state: 'AVAILABLE',
      },
      {
        commission_snapshot_id: SECOND_COMMISSION_ID,
        order_item_id: SECOND_ORDER_ITEM_ID,
        effective_rate: '3.0000',
        rule_source: 'PLATFORM',
        original_commission: '0.60',
        state: 'AVAILABLE',
      },
    ],
    aftersales: [],
    available_actions: ['VIEW_DETAIL', 'VIEW_COMMISSION'],
    timeline: [
      {
        event_id: '01JQ0000000000000000000000',
        axis: 'PAYMENT',
        event_code: 'PAYMENT_SUCCEEDED',
        from_status: 'PROCESSING',
        to_status: 'PAID',
        occurred_at: '2099-09-01T01:00:00.000Z',
      },
      {
        event_id: '01JR0000000000000000000000',
        axis: 'FULFILLMENT',
        event_code: 'DELIVERED',
        from_status: 'IN_TRANSIT',
        to_status: 'DELIVERED',
        occurred_at: '2099-09-03T01:00:00.000Z',
      },
    ],
    created_at: list.created_at,
    paid_at: list.paid_at,
  };
}

function commissionListItem(): AgentCommission {
  return {
    ledger_id: LEDGER_ID,
    commission_snapshot_id: COMMISSION_ID,
    order_id: ORDER_ID,
    order_no: `QX${ORDER_ID}`,
    order_item_id: ORDER_ITEM_ID,
    product_id: PRODUCT_ID,
    product_name: '青序净澈洗护套装',
    sku_id: SKU_ID,
    sku_name: '标准装',
    effective_rate: '5.0000',
    commission_base: '120.00',
    original_commission: '6.00',
    refund_id: null,
    ledger_type: 'AVAILABLE_CREDIT',
    position_state: 'AVAILABLE',
    expected_change: '-6.00',
    available_change: '6.00',
    reason: 'ORDER_COMPLETED',
    occurred_at: '2099-09-03T01:00:00.000Z',
  } as const;
}

function commissionListItems(): AgentCommission[] {
  const credited = commissionListItem();
  return [
    credited,
    {
      ...credited,
      ledger_id: CANCELLED_LEDGER_ID,
      commission_snapshot_id: CANCELLED_COMMISSION_ID,
      effective_rate: '4.0000',
      commission_base: '60.00',
      original_commission: '2.40',
      ledger_type: 'EXPECTED_CANCELLED',
      position_state: 'CANCELLED',
      expected_change: '-2.40',
      available_change: '0.00',
      reason: 'ORDER_CANCELLED',
      occurred_at: '2099-09-02T01:00:00.000Z',
    },
    {
      ...credited,
      ledger_id: REFUND_LEDGER_ID,
      commission_snapshot_id: REFUND_COMMISSION_ID,
      refund_id: REFUND_ID,
      ledger_type: 'REFUND_DEBIT',
      position_state: 'AVAILABLE',
      expected_change: '0.00',
      available_change: '-2.00',
      reason: 'REFUND_SUCCEEDED',
      occurred_at: '2099-09-04T01:00:00.000Z',
    },
  ];
}

function commissionDetail(): AgentCommissionDetail {
  const item = commissionListItem();
  return {
    order_id: ORDER_ID,
    order_no: `QX${ORDER_ID}`,
    item: {
      commission_snapshot_id: COMMISSION_ID,
      order_item_id: ORDER_ITEM_ID,
      product_id: PRODUCT_ID,
      product_name: item.product_name,
      sku_id: SKU_ID,
      sku_name: item.sku_name,
      category_id: CATEGORY_ID,
      category_name: '家庭洗护',
      rule_version_id: RULE_VERSION_ID,
      rule_version_no: 7,
      rule_source: 'SKU',
      hit_path: ['PLATFORM:3.0000', 'CATEGORY:4.0000', 'SKU:5.0000'],
      effective_rate: '5.0000',
      commission_base: '120.00',
      original_commission: '6.00',
      expected_remaining: '0.00',
      reversal_total: '0.00',
      rounding_mode: 'HALF_UP',
      rounding_scale: 2,
      position_state: 'AVAILABLE',
      ledger: [{
        ledger_id: LEDGER_ID,
        ledger_type: 'AVAILABLE_CREDIT',
        expected_change: '-6.00',
        available_change: '6.00',
        frozen_change: '0.00',
        refund_id: null,
        reason: 'ORDER_COMPLETED',
        occurred_at: item.occurred_at,
      }],
    },
  } as const;
}

function bankAccount(): AgentBankAccount {
  return {
    bank_account_id: BANK_ACCOUNT_ID,
    account_holder_masked: '周**',
    bank_name: '青序开发银行',
    account_number_masked: '**** 3456',
    account_no_last4: '3456',
    is_active: true,
    version: 2,
  };
}

function withdrawal(
  withdrawalId = WITHDRAWAL_ID,
  status: 'APPROVED' | 'PAID' | 'PENDING' | 'REJECTED' = 'PENDING',
): AgentWithdrawal {
  return {
    withdrawal_id: withdrawalId,
    withdrawal_no: `WD${withdrawalId}`,
    status,
    amount: '120.00',
    bank_account_masked: '**** 3456',
    review_reason: status === 'REJECTED' ? '收款资料需要更新' : null,
    created_at: '2099-09-04T01:00:00.000Z',
    reviewed_at: status === 'PENDING' ? null : '2099-09-04T01:20:00.000Z',
    paid_at: status === 'PAID' ? '2099-09-04T01:40:00.000Z' : null,
    proof_file_ids: status === 'PAID' ? [PROOF_FILE_ID] : [],
    version: status === 'PENDING' ? 1 : 2,
  };
}

class MockAgentBackend {
  readonly calls: RecordedCall[] = [];
  readonly plans = new Map<string, PlannedStep[]>();
  readonly bankAccountReplays = new Map<string, { body: RecordedCall['body']; result: AgentBankAccount }>();
  readonly withdrawalReplays = new Map<string, ReturnType<typeof withdrawal>>();
  emptyPaths = new Set<string>();
  loginRestriction: 'CHANGE_PASSWORD_ONLY' | 'NONE' = 'NONE';
  wallet: {
    available_balance: string;
    blocked_reason: string | null;
    frozen_balance: string;
    is_negative: boolean;
    version: number;
    withdrawal_allowed: boolean;
  } = {
    available_balance: '560.00',
    frozen_balance: '0.00',
    is_negative: false,
    withdrawal_allowed: true,
    blocked_reason: null,
    version: 3,
  };
  bankAccounts = [bankAccount()];
  withdrawals = [
    withdrawal(APPROVED_WITHDRAWAL_ID, 'APPROVED'),
    withdrawal(REJECTED_WITHDRAWAL_ID, 'REJECTED'),
    withdrawal(PAID_WITHDRAWAL_ID, 'PAID'),
  ];

  async install(page: Page): Promise<void> {
    await page.route('https://assets.example.test/**', (route) => route.fulfill({
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      contentType: 'image/png',
      status: 200,
    }));
    await page.route('https://downloads.example.test/**', (route) => route.fulfill({
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      contentType: 'image/png',
      headers: { 'Content-Disposition': 'attachment; filename="promotion-qr.png"' },
      status: 200,
    }));
    await page.route('**/api/v1/**', (route) => this.handle(route));
  }

  queue(method: string, path: string, ...steps: PlannedStep[]): void {
    const key = `${method.toUpperCase()} ${path}`;
    this.plans.set(key, [...(this.plans.get(key) ?? []), ...steps]);
  }

  callsFor(path: string, method?: string): RecordedCall[] {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method));
  }

  businessCalls(): RecordedCall[] {
    return this.calls.filter(({ path }) => path.startsWith('/api/v1/agent/') && !path.startsWith('/api/v1/agent/auth/'));
  }

  private record(route: Route): RecordedCall {
    const request = route.request();
    const url = new URL(request.url());
    let body: Record<string, unknown> | null = null;
    if (request.postData()) body = request.postDataJSON() as Record<string, unknown>;
    const call = {
      body,
      headers: request.headers(),
      method: request.method(),
      path: url.pathname,
      query: url.searchParams,
    };
    this.calls.push(call);
    return call;
  }

  private nextStep(call: RecordedCall): PlannedStep | undefined {
    return this.plans.get(`${call.method} ${call.path}`)?.shift();
  }

  private async intercept(route: Route, step: PlannedStep | undefined): Promise<'COMMIT_ABORT' | 'CONTINUE' | 'DONE'> {
    if (!step) return 'CONTINUE';
    if (step.kind === 'DELAY') {
      await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
      return 'CONTINUE';
    }
    if (step.kind === 'DELAY_COMMIT_ABORT') {
      await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
      return 'COMMIT_ABORT';
    }
    if (step.kind === 'COMMIT_ABORT') return 'COMMIT_ABORT';
    if (step.kind === 'ABORT') {
      await route.abort('connectionreset');
      return 'DONE';
    }
    if (step.kind === 'MALFORMED') {
      await fulfill(route, 200, success({ unexpected: true }));
      return 'DONE';
    }
    await fulfill(
      route,
      step.status,
      failure(step.code),
      step.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(step.retryAfterSeconds) },
    );
    return 'DONE';
  }

  private promotion(call: RecordedCall): AgentPromotion {
    const targetType = call.body?.target_type === 'PRODUCT' ? 'PRODUCT' : 'STOREFRONT';
    return {
      promotion_asset_id: PROMOTION_ID,
      target_type: targetType,
      target_id: targetType === 'PRODUCT' ? PRODUCT_ID : null,
      public_url: targetType === 'PRODUCT'
        ? `https://store.example.test/products/${PRODUCT_ID}?invite=B13-DEVELOPMENT`
        : 'https://store.example.test/?invite=B13-DEVELOPMENT',
      qr_file: {
        file_id: QR_FILE_ID,
        status: 'READY',
        visibility: 'PRIVATE',
        purpose: 'PROMOTION_QR',
      },
      attribution_eligible: true,
      expires_at: null,
    };
  }

  private commitWithdrawal(call: RecordedCall) {
    const key = call.headers['idempotency-key'];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const prior = this.withdrawalReplays.get(key);
    if (prior) return prior;
    expect(call.body).toEqual({ amount: '120.00', bank_account_id: BANK_ACCOUNT_ID });
    const created = withdrawal();
    this.withdrawalReplays.set(key, created);
    this.withdrawals = [created, ...this.withdrawals];
    this.wallet = {
      ...this.wallet,
      available_balance: '440.00',
      frozen_balance: '120.00',
      withdrawal_allowed: false,
      blocked_reason: 'WITHDRAWAL_IN_PROGRESS',
      version: this.wallet.version + 1,
    };
    return created;
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);
    const stepResult = await this.intercept(route, this.nextStep(call));
    if (stepResult === 'DONE') return;

    if (call.path === '/api/v1/agent/auth/login' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await fulfill(route, 200, success(
        this.loginRestriction === 'CHANGE_PASSWORD_ONLY' ? restrictedSession() : fullSession(),
      ));
      return;
    }
    if (call.path === '/api/v1/agent/auth/refresh' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.body).toEqual({ refresh_token: REFRESH_TOKEN });
      await fulfill(route, 200, success(fullSession(true)));
      return;
    }
    if (call.path === '/api/v1/agent/auth/change-temporary-password' && call.method === 'POST') {
      expect(call.headers.authorization).toBe(`Bearer ${RESTRICTED_TOKEN}`);
      await fulfill(route, 200, success(fullSession()));
      return;
    }
    if (call.path === '/api/v1/agent/auth/change-password' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      if (stepResult === 'COMMIT_ABORT') {
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 200, success(command('agent_account')));
      return;
    }
    if (call.path === '/api/v1/agent/auth/logout' && call.method === 'POST') {
      await fulfill(route, 200, success(command('agent_session', SESSION_ID)));
      return;
    }
    if (call.path === '/api/v1/agent/auth/logout-all' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      if (stepResult === 'COMMIT_ABORT') {
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 200, success(command('agent_account')));
      return;
    }
    if (call.path === '/api/v1/store/brands' && call.method === 'GET') {
      await fulfill(route, 200, success({
        items: [
          product().brand,
          {
            brand_id: SECOND_BRAND_ID,
            name: '洁净研社',
            description: '补全当前商品分页之外的公开品牌',
            logo_url: null,
            sort_order: 2,
          },
        ],
      }));
      return;
    }
    if (call.path === '/api/v1/store/categories' && call.method === 'GET') {
      await fulfill(route, 200, success({
        items: [
          product().category,
          {
            category_id: SECOND_CATEGORY_ID,
            name: '衣物清洁',
            icon_url: null,
            sort_order: 2,
          },
        ],
      }));
      return;
    }

    expect([`Bearer ${ACCESS_TOKEN}`, `Bearer ${ROTATED_ACCESS_TOKEN}`]).toContain(call.headers.authorization);
    if (call.path === '/api/v1/agent/auth/current' && call.method === 'GET') {
      await fulfill(route, 200, success({
        agent_id: AGENT_ID,
        agent_no: 'AGT-B13-001',
        name: '青序华东一级代理',
        status: 'ACTIVE',
        product_authorization_mode: 'CUSTOM_WHITELIST',
      }));
      return;
    }
    if (call.path === '/api/v1/agent/dashboard' && call.method === 'GET') {
      await fulfill(route, 200, success({
        timezone: 'Asia/Shanghai',
        as_of: NOW,
        agent_id: AGENT_ID,
        today_net_sales_amount: '120.00',
        month_net_sales_amount: '1380.00',
        today_paid_order_count: 1,
        attributed_customer_count: 18,
        expected_commission: '69.00',
        available_balance: this.wallet.available_balance,
        frozen_balance: this.wallet.frozen_balance,
        negative_balance: this.wallet.is_negative ? '20.00' : '0.00',
        pending_withdrawal_count: this.withdrawals.filter(({ status }) => status === 'PENDING').length,
        todo: {
          commission_exception_count: 1,
          withdrawal_action_count: (this.bankAccounts.length ? 0 : 1) +
            this.withdrawals.filter(({ status }) => status === 'PENDING' || status === 'APPROVED').length +
            (this.wallet.is_negative ? 1 : 0),
        },
        trend: [{
          business_date: '2099-09-04',
          net_sales_amount: '120.00',
          paid_order_count: 1,
          commission_change: '6.00',
        }],
      }));
      return;
    }
    if (call.path === '/api/v1/agent/products' && call.method === 'GET') {
      await fulfill(route, 200, success(pagination(this.emptyPaths.has(call.path) ? [] : [product()])));
      return;
    }
    if (call.path === `/api/v1/agent/products/${PRODUCT_ID}` && call.method === 'GET') {
      await fulfill(route, 200, success(product()));
      return;
    }
    if (call.path === '/api/v1/agent/promotion-assets' && call.method === 'POST') {
      expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      if (stepResult === 'COMMIT_ABORT') {
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 200, success(this.promotion(call)));
      return;
    }
    if (call.path === '/api/v1/agent/customers' && call.method === 'GET') {
      await fulfill(route, 200, success(pagination(this.emptyPaths.has(call.path) ? [] : [customerListItem()])));
      return;
    }
    if (call.path === `/api/v1/agent/customers/${CUSTOMER_ID}` && call.method === 'GET') {
      await fulfill(route, 200, success(customerDetail()));
      return;
    }
    if (call.path === '/api/v1/agent/orders' && call.method === 'GET') {
      await fulfill(route, 200, success(pagination(this.emptyPaths.has(call.path) ? [] : [orderListItem()])));
      return;
    }
    if (call.path === `/api/v1/agent/orders/${ORDER_ID}` && call.method === 'GET') {
      await fulfill(route, 200, success(orderDetail()));
      return;
    }
    if (call.path === '/api/v1/agent/commissions' && call.method === 'GET') {
      await fulfill(route, 200, success(pagination(this.emptyPaths.has(call.path) ? [] : commissionListItems())));
      return;
    }
    if (call.path === `/api/v1/agent/commissions/${COMMISSION_ID}` && call.method === 'GET') {
      await fulfill(route, 200, success(commissionDetail()));
      return;
    }
    if (call.path === '/api/v1/agent/wallet' && call.method === 'GET') {
      await fulfill(route, 200, success(this.wallet));
      return;
    }
    if (call.path === '/api/v1/agent/bank-accounts' && call.method === 'GET') {
      await fulfill(route, 200, success(this.emptyPaths.has(call.path) ? [] : this.bankAccounts));
      return;
    }
    if (call.path === '/api/v1/agent/bank-accounts' && call.method === 'POST') {
      const key = call.headers['idempotency-key'];
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      const prior = this.bankAccountReplays.get(key);
      if (prior) expect(call.body).toEqual(prior.body);
      const result = prior?.result ?? bankAccount();
      if (!prior) {
        this.bankAccountReplays.set(key, { body: call.body, result });
        this.bankAccounts = [result];
      }
      if (stepResult === 'COMMIT_ABORT') {
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 200, success(result));
      return;
    }
    if (call.path === '/api/v1/agent/withdrawals' && call.method === 'GET') {
      await fulfill(route, 200, success(pagination(this.emptyPaths.has(call.path) ? [] : this.withdrawals)));
      return;
    }
    if (call.path === '/api/v1/agent/withdrawals' && call.method === 'POST') {
      const result = this.commitWithdrawal(call);
      if (stepResult === 'COMMIT_ABORT') {
        await route.abort('connectionreset');
        return;
      }
      await fulfill(route, 201, success(result));
      return;
    }
    if (call.path.startsWith('/api/v1/agent/withdrawals/') && call.method === 'GET') {
      const id = call.path.split('/').at(-1);
      const item = this.withdrawals.find(({ withdrawal_id: withdrawalId }) => withdrawalId === id) ?? withdrawal();
      await fulfill(route, 200, success(item));
      return;
    }
    if (call.path === `/api/v1/files/${QR_FILE_ID}/download-url` && call.method === 'GET') {
      await fulfill(route, 200, success({
        file_id: QR_FILE_ID,
        download_url: 'https://downloads.example.test/promotion-qr.png',
        expires_at: '2099-09-04T02:05:00.000Z',
      }));
      return;
    }
    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE'));
  }
}

function isStateMatrixProject(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function expectFullyInViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectDialogActionInViewport(page: Page, testid: string): Promise<void> {
  await expectFullyInViewport(page, page.locator(`[data-testid="${testid}"]:visible`));
}

async function expectMainActionAboveMobileNavigation(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1024) > 600) return;
  const action = page.locator('[data-testid="agent-primary-action"]:visible').last();
  const navigation = page.locator('[data-testid="agent-mobile-navigation"]:visible');
  await action.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expectFullyInViewport(page, action);
  await expectFullyInViewport(page, navigation);
  const [actionBox, navigationBox] = await Promise.all([action.boundingBox(), navigation.boundingBox()]);
  expect(actionBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navigationBox!.y);
}

async function fillLogin(page: Page): Promise<void> {
  await page.getByTestId('agent-login-name').fill('agent.b13');
  await page.getByTestId('agent-login-password').fill(['Runtime', 'Password', 'B13'].join(''));
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await fillLogin(page);
  await page.getByTestId('agent-login-submit').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const routeLabels = {
  account: '账户与安全',
  commissions: '佣金明细',
  customers: '我的客户',
} as const;

async function navigateTo(
  page: Page,
  route: 'account' | 'commissions' | 'customers' | 'dashboard' | 'orders' | 'products' | 'wallet',
): Promise<void> {
  if ((page.viewportSize()?.width ?? 1024) <= 600) {
    if (route in routeLabels) {
      await page.getByTestId('agent-mobile-nav-more').click();
      await page.getByRole('button', { name: new RegExp(routeLabels[route as keyof typeof routeLabels]) }).click();
    } else {
      await page.getByTestId(`agent-mobile-nav-${route}`).click();
    }
  } else {
    await page.getByTestId(`agent-nav-${route}`).click();
  }
  await expect(page).toHaveURL(new RegExp(`/${route}(?:\\?.*)?$`));
}

async function retryPageState(page: Page, testid: string): Promise<void> {
  const state = page.getByTestId(`${testid}-error`);
  await expect(state).toBeVisible();
  await state.getByRole('button', { name: '重新加载' }).click();
}

async function expectResponsivePage(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectMainActionAboveMobileNavigation(page);
}

test('AGT-01..09 completes the agent workbench journey at every viewport', async ({ page }) => {
  const backend = new MockAgentBackend();
  await backend.install(page);
  await signIn(page);
  await expect(page.getByTestId('dashboard-metrics')).toContainText('¥ 120.00');
  await expect(page.getByTestId('dashboard-wallet')).toContainText('¥ 560.00');
  await expect(page.getByRole('link', { name: /提现事项/ })).toContainText('1');
  expect(Object.fromEntries(backend.callsFor('/api/v1/agent/dashboard', 'GET')[0]?.query ?? []))
    .toEqual({ days: '7' });
  await page.getByTestId('dashboard-trend-days').getByText('30 日', { exact: true }).click();
  await expect.poll(() => backend.callsFor('/api/v1/agent/dashboard', 'GET').length).toBe(2);
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  expect(Object.fromEntries(backend.callsFor('/api/v1/agent/dashboard', 'GET').at(-1)?.query ?? []))
    .toEqual({ days: '30' });
  await expectResponsivePage(page);

  await navigateTo(page, 'products');
  await expect(page.getByText('青序净澈洗护套装', { exact: true })).toBeVisible();
  expect(backend.callsFor('/api/v1/store/brands', 'GET')).toHaveLength(1);
  expect(backend.callsFor('/api/v1/store/categories', 'GET')).toHaveLength(1);
  await page.getByTestId('products-brand').click();
  await page.getByRole('option', { name: '洁净研社', exact: true }).click();
  await expect(page.getByTestId('products-brand')).toContainText('洁净研社');
  await page.getByTestId('products-category').click();
  await page.getByRole('option', { name: '衣物清洁', exact: true }).click();
  await expect(page.getByTestId('products-category')).toContainText('衣物清洁');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => backend.callsFor('/api/v1/agent/products', 'GET').length).toBe(2);
  expect(Object.fromEntries(backend.callsFor('/api/v1/agent/products', 'GET').at(-1)?.query ?? []))
    .toMatchObject({ brand_id: SECOND_BRAND_ID, category_id: SECOND_CATEGORY_ID });
  expect(backend.callsFor('/api/v1/store/brands', 'GET')).toHaveLength(1);
  expect(backend.callsFor('/api/v1/store/categories', 'GET')).toHaveLength(1);
  await expect(page.locator(`[data-testid="product-promote-${PRODUCT_ID}"]:visible`)).toBeVisible();
  await page.locator(`[data-testid="product-detail-${PRODUCT_ID}"]:visible`).click();
  await expect(page.getByTestId('product-detail')).toContainText('无佣金');
  await expect(page.getByTestId('product-detail')).toContainText('5%');
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('product-detail')).toBeHidden();
  await expectResponsivePage(page);

  await navigateTo(page, 'customers');
  await expect(page.locator(`[data-testid="customer-detail-${CUSTOMER_ID}"]:visible`)).toBeVisible();
  await expectResponsivePage(page);

  await navigateTo(page, 'orders');
  await page.locator(`[data-testid="order-detail-${ORDER_ID}"]:visible`).click();
  await expect(page.getByTestId('order-detail')).toContainText('部分退款');
  await expect(page.getByTestId('order-detail')).toContainText('佣金快照');
  await expect(page.getByTestId('order-detail')).toContainText('标准装');
  await expect(page.getByTestId('order-detail')).toContainText('试用装');
  await expect(page.getByTestId('order-detail')).toContainText('5%');
  await expect(page.getByTestId('order-detail')).toContainText('3%');
  await expect(page.getByTestId('order-commission-total')).toHaveText('合计 ¥ 6.60');
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('order-detail')).toBeHidden();
  await expectResponsivePage(page);

  await navigateTo(page, 'commissions');
  const visibleCommissionList = page.locator('.desktop-table:visible, .mobile-list:visible').last();
  await expect(visibleCommissionList).toContainText('退款冲减');
  await expect(visibleCommissionList).toContainText(/(?:已取消|待结算取消)/);
  await page.locator(`[data-testid="commission-detail-${COMMISSION_ID}"]:visible`).click();
  await expect(page.getByTestId('commission-detail')).toContainText('SKU:5.0000');
  await expect(page.getByTestId('commission-detail')).toContainText('¥ 6.00');
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('commission-detail')).toBeHidden();
  await expectResponsivePage(page);

  backend.wallet = {
    available_balance: '-20.00',
    frozen_balance: '120.00',
    is_negative: true,
    withdrawal_allowed: false,
    blocked_reason: 'NEGATIVE_BALANCE',
    version: 4,
  };
  await navigateTo(page, 'wallet');
  await expect(page.getByText('负向余额', { exact: true })).toBeVisible();
  await expect(page.getByTestId('withdrawal-blocked')).toContainText('当前为负余额');
  await expect(page.locator('.desktop-table:visible, .mobile-list:visible').last()).toContainText('已审核，待打款');
  await expect(page.getByText('**** 3456', { exact: true }).first()).toBeVisible();
  await page.locator(`[data-testid="withdrawal-detail-${PAID_WITHDRAWAL_ID}"]:visible`).click();
  await expect(page.getByTestId('withdrawal-detail')).toContainText('1 份（由总部保管）');
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('withdrawal-detail')).toBeHidden();
  await expectResponsivePage(page);

  await navigateTo(page, 'account');
  await expect(page.getByText('青序华东一级代理', { exact: true })).toBeVisible();
  await expect(page.getByText('AGT-B13-001', { exact: true })).toBeVisible();
  await expectResponsivePage(page);

  const currentPassword = ['Runtime', 'Password', 'B13'].join('');
  const nextPassword = ['Next', 'Runtime', 'Password', 'B13'].join('');
  await page.locator('[data-testid="agent-primary-action"]:visible').click();
  await page.getByTestId('account-current-password').fill(currentPassword);
  await page.getByTestId('account-new-password').fill(nextPassword);
  await page.getByTestId('account-confirm-password').fill(nextPassword);
  await page.getByTestId('account-password-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('account-password-dialog')).toBeHidden();
  const passwordCalls = backend.callsFor('/api/v1/agent/auth/change-password', 'POST');
  expect(passwordCalls).toHaveLength(1);
  expect(passwordCalls[0]?.body).toEqual({ current_password: currentPassword, new_password: nextPassword });

  await signIn(page);
  await navigateTo(page, 'account');
  await page.getByTestId('account-logout-all').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(backend.callsFor('/api/v1/agent/auth/logout-all', 'POST')).toHaveLength(1);
  expect(backend.callsFor('/api/v1/agent/auth/current', 'GET').length).toBeGreaterThanOrEqual(2);
});

test('AGT-01 confines a temporary session to one password change', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The restricted-session matrix runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.loginRestriction = 'CHANGE_PASSWORD_ONLY';
  await backend.install(page);

  await page.goto('/login');
  await fillLogin(page);
  await page.getByTestId('agent-login-submit').click();
  await expect(page).toHaveURL(/\/change-password$/);
  expect(backend.businessCalls()).toHaveLength(0);
  expect(backend.callsFor('/api/v1/agent/auth/refresh', 'POST')).toHaveLength(0);

  const storageBeforeChange = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(storageBeforeChange).not.toContain(REFRESH_TOKEN);

  const currentPassword = ['Runtime', 'Password', 'B13'].join('');
  const newPassword = ['Replacement', 'Password', 'B13'].join('');
  await page.getByTestId('agent-current-password').fill(currentPassword);
  await page.getByTestId('agent-new-password').fill(newPassword);
  await page.getByTestId('agent-confirm-password').fill(newPassword);
  await page.getByTestId('agent-forced-password-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(/\/dashboard$/);

  const calls = backend.callsFor('/api/v1/agent/auth/change-temporary-password', 'POST');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.headers.authorization).toBe(`Bearer ${RESTRICTED_TOKEN}`);
  expect(calls[0]?.body).toEqual({ current_password: currentPassword, new_password: newPassword });
  await expectNoHorizontalOverflow(page);
});

test('AGT-01 lets a restricted session perform LOGOUT without reaching business APIs', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The restricted logout runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.loginRestriction = 'CHANGE_PASSWORD_ONLY';
  await backend.install(page);

  await page.goto('/login');
  await fillLogin(page);
  await page.getByTestId('agent-login-submit').click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByTestId('agent-current-password').fill('Temporary secret to clear');
  await page.getByTestId('agent-new-password').fill('Replacement secret to clear');
  await page.getByTestId('agent-confirm-password').fill('Replacement secret to clear');
  await page.getByTestId('agent-restricted-logout').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect(page).toHaveURL(/\/login$/);

  const calls = backend.callsFor('/api/v1/agent/auth/logout', 'POST');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.headers.authorization).toBe(`Bearer ${RESTRICTED_TOKEN}`);
  expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls[0]?.body).toBeNull();
  expect(backend.businessCalls()).toHaveLength(0);
  expect(backend.callsFor('/api/v1/agent/auth/refresh', 'POST')).toHaveLength(0);
  const cleared = await page.evaluate(() => JSON.stringify({
    inputs: [...document.querySelectorAll('input')].map((input) => input.value),
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(cleared).not.toContain('Temporary secret to clear');
  expect(cleared).not.toContain('Replacement secret to clear');
  expect(cleared).not.toContain(RESTRICTED_TOKEN);
  await expectNoHorizontalOverflow(page);
});

test('AGT-09 retries an unknown password change with the original request and clears secrets', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The password recovery runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.queue(
    'POST',
    '/api/v1/agent/auth/change-password',
    { kind: 'ABORT' },
    { kind: 'DELAY_COMMIT_ABORT', milliseconds: 350 },
    { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 },
  );
  backend.queue('POST', '/api/v1/agent/auth/refresh', { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 });
  await backend.install(page);
  await signIn(page);
  await navigateTo(page, 'account');

  const currentPassword = ['Current', 'Runtime', 'Password', 'B13'].join('');
  const nextPassword = ['Next', 'Runtime', 'Password', 'B13'].join('');
  await page.locator('[data-testid="agent-primary-action"]:visible').click();
  await page.getByTestId('account-current-password').fill(currentPassword);
  await page.getByTestId('account-new-password').fill(nextPassword);
  await page.getByTestId('account-confirm-password').fill(nextPassword);
  await page.getByTestId('account-password-submit').click();
  await expect(page.getByTestId('account-password-error')).toContainText('修改结果未确认');
  await expect(page.getByTestId('account-current-password')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('account-password-dialog')).toBeVisible();
  await page.getByTestId('account-password-submit').click();
  await expect(page.getByTestId('account-password-error')).toContainText('修改结果未确认');
  await expect(page.getByTestId('account-password-dialog')).toBeVisible();
  await page.getByTestId('account-password-submit').click();
  await expect.poll(() => backend.callsFor('/api/v1/agent/auth/refresh', 'POST').length).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('account-password-dialog')).toBeHidden();

  const calls = backend.callsFor('/api/v1/agent/auth/change-password', 'POST');
  expect(calls).toHaveLength(3);
  expect(calls[0]?.body).toEqual({ current_password: currentPassword, new_password: nextPassword });
  expect(calls[1]?.body).toEqual(calls[0]?.body);
  expect(calls[1]?.headers['idempotency-key']).toBe(calls[0]?.headers['idempotency-key']);
  expect(calls[2]?.body).toEqual(calls[1]?.body);
  expect(calls[2]?.headers['idempotency-key']).toBe(calls[1]?.headers['idempotency-key']);
  const exposedSecrets = await page.evaluate(() => JSON.stringify({
    inputs: [...document.querySelectorAll('input')].map((input) => input.value),
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(exposedSecrets).not.toContain(currentPassword);
  expect(exposedSecrets).not.toContain(nextPassword);
});

test('AGT-01 keeps login enumeration closed and honors Retry-After', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The login failure matrix runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.queue(
    'POST',
    '/api/v1/agent/auth/login',
    { code: 'AUTH_FAILED', kind: 'FAILURE', status: 401 },
    { code: 'AGENT_DISABLED', kind: 'FAILURE', status: 403 },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 7, status: 429 },
  );
  await backend.install(page);
  await page.goto('/login');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await fillLogin(page);
    await page.getByTestId('agent-login-submit').click();
    await expect(page.getByTestId('agent-login-error'))
      .toHaveText('账号或密码错误，请重试；账号停用请联系总部');
    await expect(page.getByTestId('agent-login-password')).toHaveValue('');
  }

  await fillLogin(page);
  await page.getByTestId('agent-login-submit').click();
  await expect(page.getByTestId('agent-login-error')).toContainText('7 秒后重试');
  await expect(page.getByTestId('agent-login-submit')).toBeDisabled();
  expect(backend.callsFor('/api/v1/agent/auth/login', 'POST')).toHaveLength(3);
  expect(backend.businessCalls()).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
});

test('AGT-01 refreshes concurrent reads once and clears a session when refresh fails', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The refresh race runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.queue('GET', '/api/v1/agent/dashboard', { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 });
  backend.queue('GET', '/api/v1/agent/orders', { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 });
  backend.queue('POST', '/api/v1/agent/auth/refresh', { kind: 'DELAY', milliseconds: 200 });
  await backend.install(page);

  await signIn(page);
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  expect(backend.callsFor('/api/v1/agent/auth/refresh', 'POST')).toHaveLength(1);
  expect(backend.callsFor('/api/v1/agent/dashboard', 'GET')).toHaveLength(2);
  expect(backend.callsFor('/api/v1/agent/orders', 'GET')).toHaveLength(2);
  expect(backend.callsFor('/api/v1/agent/dashboard', 'GET')[1]?.headers.authorization)
    .toBe(`Bearer ${ROTATED_ACCESS_TOKEN}`);
  expect(backend.callsFor('/api/v1/agent/orders', 'GET')[1]?.headers.authorization)
    .toBe(`Bearer ${ROTATED_ACCESS_TOKEN}`);

  await navigateTo(page, 'products');
  await expect(page.getByText('青序净澈洗护套装', { exact: true })).toBeVisible();
  backend.queue('GET', '/api/v1/agent/dashboard', { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 });
  backend.queue('POST', '/api/v1/agent/auth/refresh', { code: 'AUTH_REQUIRED', kind: 'FAILURE', status: 401 });
  await page.locator('[data-testid="agent-nav-dashboard"]:visible, [data-testid="agent-mobile-nav-dashboard"]:visible').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(backend.callsFor('/api/v1/agent/auth/refresh', 'POST')).toHaveLength(2);
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(storage).not.toContain(ACCESS_TOKEN);
  expect(storage).not.toContain(ROTATED_ACCESS_TOKEN);
  expect(storage).not.toContain(REFRESH_TOKEN);
  expect(storage).not.toContain(ROTATED_REFRESH_TOKEN);
});

test('AGT-02 fails closed across slow, domain, network and malformed responses', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The read-state matrix runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.queue('GET', '/api/v1/agent/dashboard', { kind: 'DELAY', milliseconds: 700 });
  backend.queue(
    'GET',
    '/api/v1/agent/products',
    { code: 'FORBIDDEN', kind: 'FAILURE', status: 403 },
    { code: 'STATE_CONFLICT', kind: 'FAILURE', status: 409 },
    { code: 'VALIDATION_FAILED', kind: 'FAILURE', status: 422 },
    { code: 'RATE_LIMITED', kind: 'FAILURE', retryAfterSeconds: 3, status: 429 },
    { code: 'INTERNAL_ERROR', kind: 'FAILURE', status: 500 },
    { kind: 'ABORT' },
    { kind: 'MALFORMED' },
  );
  await backend.install(page);

  await signIn(page);
  await expect(page.getByTestId('dashboard-state-loading')).toBeVisible();
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  await navigateTo(page, 'products');

  const messages = [
    '当前账号无权访问授权商品',
    '授权商品状态已变化，请刷新后重试',
    '授权商品暂不可用，请检查当前业务状态',
    '查询过于频繁，请在 3 秒后重试',
    '授权商品暂不可用，请稍后重试',
    '网络连接失败，请检查网络后重试',
    '授权商品暂不可用，请稍后重试',
  ];
  for (const message of messages) {
    const error = page.getByTestId('products-state-error');
    await expect(error).toContainText(message);
    await expect(page.locator('.product-card')).toHaveCount(0);
    await retryPageState(page, 'products-state');
  }
  await expect(page.getByText('青序净澈洗护套装', { exact: true })).toBeVisible();
  expect(backend.callsFor('/api/v1/agent/products', 'GET')).toHaveLength(messages.length + 1);
  backend.emptyPaths.add('/api/v1/agent/products');
  await page.getByTestId('products-keyword').press('Enter');
  await expect(page.getByTestId('products-state-empty')).toContainText('暂无可推广的授权商品');
  await expectNoHorizontalOverflow(page);
  await expectMainActionAboveMobileNavigation(page);
});

test('AGT-03/04 keeps customer drill-down scoped and carries only the customer query', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The scoped drill-down runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  await backend.install(page);
  await signIn(page);
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  await navigateTo(page, 'customers');
  await expect(page.locator(`[data-testid="customer-detail-${CUSTOMER_ID}"]:visible`)).toBeVisible();

  backend.queue(
    'GET',
    `/api/v1/agent/customers/${CUSTOMER_ID}`,
    { code: 'NOT_FOUND', kind: 'FAILURE', status: 404 },
  );
  await page.locator(`[data-testid="customer-detail-${CUSTOMER_ID}"]:visible`).click();
  await expect(page.getByTestId('customer-detail-state-error')).toContainText('客户详情不存在或已不可访问');
  await expect(page.locator('body')).not.toContainText(FULL_PHONE_FIXTURE);
  await retryPageState(page, 'customer-detail-state');
  await expect(page.getByTestId('customer-detail')).toContainText('当前归属期订单');
  await page.getByTestId('customer-orders-link').click();

  await expect(page).toHaveURL(new RegExp(`/orders\\?customer_id=${CUSTOMER_ID}$`));
  await expect(page.getByTestId('orders-customer-filter')).toBeVisible();
  const orderListCall = backend.callsFor('/api/v1/agent/orders', 'GET').at(-1);
  expect(Object.fromEntries(orderListCall?.query ?? [])).toEqual({
    customer_id: CUSTOMER_ID,
    page: '1',
    page_size: '20',
    sort: 'CREATED_DESC',
  });
  await page.locator(`[data-testid="order-detail-${ORDER_ID}"]:visible`).click();
  await expect(page.getByTestId('order-detail')).toContainText('浙江省杭州市');
  await expect(page.getByTestId('order-detail')).not.toContainText(FULL_PHONE_FIXTURE);
  await expectNoHorizontalOverflow(page);
  await expectMainActionAboveMobileNavigation(page);
});

test('AGT-02 creates promotion once and reauthenticates every QR download', async ({ context, page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The promotion command matrix runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.queue(
    'POST',
    '/api/v1/agent/promotion-assets',
    { code: 'PROMOTION_UNAVAILABLE', kind: 'FAILURE', status: 422 },
    { kind: 'DELAY_COMMIT_ABORT', milliseconds: 350 },
    { kind: 'DELAY', milliseconds: 350 },
  );
  await backend.install(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();

  await page.locator('[data-testid="agent-primary-action"]:visible').click();
  await expect(page.getByTestId('promotion-dialog')).toBeVisible();
  await expectDialogActionInViewport(page, 'promotion-create');
  await page.getByTestId('promotion-create').click();
  await expect(page.getByTestId('promotion-error')).toBeVisible();
  await expect(page.getByTestId('promotion-dialog')).toBeVisible();
  await page.getByTestId('promotion-create').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect.poll(() => backend.callsFor('/api/v1/agent/promotion-assets', 'POST').length).toBe(2);
  await expect(page.getByTestId('promotion-create')).toBeDisabled();
  await expect(page.getByTestId('promotion-dialog').getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await expect(page.getByTestId('promotion-dialog').locator('.el-dialog__headerbtn')).toBeHidden();
  await expectDialogActionInViewport(page, 'promotion-create');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('promotion-dialog')).toBeVisible();
  await expect(page.getByTestId('promotion-create')).toBeDisabled();
  await expect(page.getByTestId('promotion-error')).toContainText('生成结果未确认');
  await expect(page.getByTestId('promotion-create')).toHaveText('使用原请求重试');
  await expect(page.getByTestId('promotion-dialog').getByRole('button', { name: '关闭', exact: true })).toBeHidden();
  await expect(page.getByTestId('promotion-dialog').locator('.el-dialog__headerbtn')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('promotion-dialog')).toBeVisible();
  await page.getByTestId('promotion-create').click();
  await expect.poll(() => backend.callsFor('/api/v1/agent/promotion-assets', 'POST').length).toBe(3);
  await expect(page.getByTestId('promotion-qr')).toBeVisible();
  const createCalls = backend.callsFor('/api/v1/agent/promotion-assets', 'POST');
  expect(createCalls).toHaveLength(3);
  expect(createCalls[0]?.body).toEqual({ target_id: null, target_type: 'STOREFRONT' });
  expect(createCalls[1]?.body).toEqual(createCalls[0]?.body);
  expect(createCalls[1]?.headers['idempotency-key']).toBe(createCalls[0]?.headers['idempotency-key']);
  expect(createCalls[2]?.body).toEqual(createCalls[1]?.body);
  expect(createCalls[2]?.headers['idempotency-key']).toBe(createCalls[1]?.headers['idempotency-key']);
  await expectFullyInViewport(
    page,
    page.getByTestId('promotion-dialog').getByRole('button', { name: '关闭', exact: true }),
  );

  await page.getByTestId('promotion-copy').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('https://store.example.test/?invite=B13-DEVELOPMENT');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('promotion-download').click(),
    ]);
  }
  const downloads = backend.callsFor(`/api/v1/files/${QR_FILE_ID}/download-url`, 'GET');
  expect(downloads).toHaveLength(3);
  expect(downloads.every(({ headers }) => headers.authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('AGT-07/08 recovers bank and withdrawal writes with the original body and key', async ({ page }, testInfo) => {
  test.skip(!isStateMatrixProject(testInfo.project.name), 'The finance command matrix runs at 390 and 1024 widths.');
  const backend = new MockAgentBackend();
  backend.emptyPaths.add('/api/v1/agent/bank-accounts');
  backend.emptyPaths.add('/api/v1/agent/withdrawals');
  await backend.install(page);
  await signIn(page);
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  await navigateTo(page, 'wallet');
  await expect(page.getByTestId('bank-accounts-state-empty')).toBeVisible();
  await expect(page.getByTestId('withdrawals-state-empty')).toBeVisible();
  await expect(page.locator('[data-testid="agent-primary-action"]:visible')).toBeDisabled();

  await page.getByTestId('bank-account-open').click();
  await page.getByTestId('bank-account-holder').fill('周青');
  await page.getByTestId('bank-account-bank').fill('青序开发银行');
  await page.getByTestId('bank-account-number').fill(RAW_BANK_ACCOUNT);
  backend.emptyPaths.delete('/api/v1/agent/bank-accounts');
  backend.queue('POST', '/api/v1/agent/bank-accounts', { kind: 'DELAY_COMMIT_ABORT', milliseconds: 350 });
  await page.getByTestId('bank-account-submit').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect.poll(() => backend.callsFor('/api/v1/agent/bank-accounts', 'POST').length).toBe(1);
  await expect(page.getByTestId('bank-account-submit')).toBeDisabled();
  await expect(page.getByTestId('bank-account-dialog').getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await expect(page.getByTestId('bank-account-dialog').locator('.el-dialog__headerbtn')).toBeHidden();
  await expectDialogActionInViewport(page, 'bank-account-submit');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bank-account-dialog')).toBeVisible();
  await expect(page.getByTestId('bank-account-holder')).toHaveValue('周青');
  await expect(page.getByTestId('bank-account-bank')).toHaveValue('青序开发银行');
  await expect(page.getByTestId('bank-account-number')).toHaveValue(RAW_BANK_ACCOUNT);
  await expect(page.getByTestId('bank-account-error')).toContainText('保存结果未确认');
  await expect(page.getByTestId('bank-account-holder')).toBeDisabled();
  await expect(page.getByTestId('bank-account-bank')).toBeDisabled();
  await expect(page.getByTestId('bank-account-number')).toBeDisabled();
  await expect(page.getByTestId('bank-account-submit')).toHaveText('使用原请求重试');
  await page.getByTestId('bank-account-submit').click();
  await expect(page.getByTestId('bank-account-dialog')).toBeHidden();
  await expect(page.getByText('**** 3456', { exact: true })).toBeVisible();
  const bankCalls = backend.callsFor('/api/v1/agent/bank-accounts', 'POST');
  expect(bankCalls).toHaveLength(2);
  expect(bankCalls[0]?.body).toEqual({
    account_holder: '周青',
    account_number: RAW_BANK_ACCOUNT,
    bank_name: '青序开发银行',
  });
  expect(bankCalls[1]?.body).toEqual(bankCalls[0]?.body);
  expect(bankCalls[1]?.headers['idempotency-key']).toBe(bankCalls[0]?.headers['idempotency-key']);
  expect(backend.bankAccountReplays.size).toBe(1);
  const exposedSecrets = await page.evaluate(() => JSON.stringify({
    inputs: [...document.querySelectorAll('input')].map((input) => input.value),
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
    text: document.body.innerText,
  }));
  expect(exposedSecrets).not.toContain(RAW_BANK_ACCOUNT);
  expect(exposedSecrets).not.toContain(RAW_BANK_ACCOUNT.replaceAll(' ', ''));
  expect(exposedSecrets).not.toContain('周青');

  await page.locator('[data-testid="agent-primary-action"]:visible').click();
  await expect(page.getByTestId('withdrawal-form')).toBeVisible();
  await page.getByTestId('withdrawal-amount').fill('120.00');
  expect(backend.callsFor('/api/v1/agent/withdrawals', 'POST')).toHaveLength(0);
  await page.getByTestId('withdrawal-continue').click();
  await expect(page.getByTestId('withdrawal-confirmation')).toContainText('¥ 120.00');
  await expect(page.getByTestId('withdrawal-confirmation')).toContainText('**** 3456');
  await expectDialogActionInViewport(page, 'withdrawal-confirm');
  expect(backend.callsFor('/api/v1/agent/withdrawals', 'POST')).toHaveLength(0);

  backend.emptyPaths.delete('/api/v1/agent/withdrawals');
  backend.queue('POST', '/api/v1/agent/withdrawals', { kind: 'DELAY_COMMIT_ABORT', milliseconds: 350 });
  await page.getByTestId('withdrawal-confirm').evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  await expect.poll(() => backend.callsFor('/api/v1/agent/withdrawals', 'POST').length).toBe(1);
  await expect(page.getByTestId('withdrawal-confirm')).toBeDisabled();
  await expect(page.getByTestId('withdrawal-dialog').getByRole('button', { name: '返回修改', exact: true })).toBeDisabled();
  await expect(page.getByTestId('withdrawal-dialog').locator('.el-dialog__headerbtn')).toBeHidden();
  await expectDialogActionInViewport(page, 'withdrawal-confirm');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('withdrawal-dialog')).toBeVisible();
  await expect(page.getByTestId('withdrawal-confirmation')).toContainText('¥ 120.00');
  await expect(page.getByTestId('withdrawal-confirmation')).toContainText('**** 3456');
  await expect(page.getByTestId('withdrawal-error')).toContainText('响应未确认');
  await expect(page.getByTestId('withdrawal-retry')).toBeVisible();
  await expect(page.getByTestId('withdrawal-dialog').locator('.el-dialog__headerbtn')).toBeHidden();
  await expectDialogActionInViewport(page, 'withdrawal-retry');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('withdrawal-dialog')).toBeVisible();
  await expect(page.getByTestId('withdrawal-confirmation')).toContainText('¥ 120.00');
  await page.getByTestId('withdrawal-retry').click();
  await expect(page.getByTestId('withdrawal-dialog')).toBeHidden();

  const withdrawalCalls = backend.callsFor('/api/v1/agent/withdrawals', 'POST');
  expect(withdrawalCalls).toHaveLength(2);
  expect(withdrawalCalls[0]?.headers['idempotency-key']).toBe(withdrawalCalls[1]?.headers['idempotency-key']);
  expect(withdrawalCalls[0]?.body).toEqual(withdrawalCalls[1]?.body);
  expect(backend.withdrawalReplays.size).toBe(1);
  await expect(page.getByTestId('withdrawal-blocked')).toContainText('已有提现申请正在处理中');
  await expect(page.locator(`[data-testid="withdrawal-detail-${WITHDRAWAL_ID}"]:visible`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectMainActionAboveMobileNavigation(page);
});
