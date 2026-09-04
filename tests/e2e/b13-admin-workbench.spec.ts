import { expect, test, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function fixtureUlid(seed: number): string {
  let value = seed;
  let suffix = '';
  for (let index = 0; index < 7; index += 1) {
    suffix = CROCKFORD[value % CROCKFORD.length] + suffix;
    value = Math.floor(value / CROCKFORD.length);
  }
  return '01ARZ3NDEKTSV4RRFFQ' + suffix;
}

const ACCESS_TOKEN = ['access', 'b13', 'admin'].join('-');
const REFRESH_TOKEN = ['refresh', 'b13', 'admin'].join('-');
const PREAUTH_TOKEN = ['preauth', 'b13', 'admin'].join('-');
const TEMPORARY_PASSWORD = ['Temporary', 'B13', 'Credential'].join('-');
const INITIAL_INVITE_CODE = ['INVITE', 'B13', 'FIRST'].join('-');
const RAW_PAYOUT_ACCOUNT = ['123', '456', '789'].join('');
const CONTACT_PHONE = ['100', '0000', '0000'].join('');
const ACCOUNT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SESSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const CUSTOMER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const BINDING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const AGENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const SECOND_AGENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const NEW_AGENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const AGENT_ACCOUNT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const SECOND_AGENT_ACCOUNT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB3';
const NEW_AGENT_ACCOUNT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB4';
const INVITE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB5';
const NEW_INVITE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB6';
const CATEGORY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB7';
const SECOND_CATEGORY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB8';
const SKU_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB9';
const SECOND_SKU_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBA';
const RULE_VERSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBB';
const NEXT_RULE_VERSION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBC';
const WITHDRAWAL_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBD';
const PROOF_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBE';
const AUDIT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBF';
const PAGE_TWO_AGENT_ID = fixtureUlid(10_101);
const PAGE_TWO_PRODUCT_ID = fixtureUlid(20_101);
const EXPLANATION_ORDER_ID = fixtureUlid(40_101);
const EXPLANATION_ORDER_ITEM_ID = fixtureUlid(40_102);
const EXPLANATION_PRODUCT_ID = fixtureUlid(40_103);
const EXPLANATION_SNAPSHOT_ID = fixtureUlid(40_104);
const EXPLANATION_LEDGER_ID = fixtureUlid(40_105);
const PAGE_TWO_RULE_VERSION_ID = fixtureUlid(50_101);
const PREVIEW_TOKEN = 'preview_b13_admin_controlled';
const NOW = '2099-09-04T01:00:00.000Z';
const LATER = '2099-09-04T01:10:00.000Z';
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

interface Call {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: Record<string, string>;
}

type FailureStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500;
type Step =
  | { code: string; retryAfter?: number; status: FailureStatus }
  | { kind: 'ABORT' }
  | { kind: 'ABORT_COMMIT' }
  | { kind: 'DELAY'; ms: number };

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_b13_admin' };
}

function failure(code: string) {
  return { code, message: 'controlled internal detail', request_id: 'req_b13_admin_error' };
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

class MockAdminWorkbenchBackend {
  readonly calls: Call[] = [];
  readonly unhandled: string[] = [];
  readonly steps = new Map<string, Step[]>();
  agentStatus: 'ACTIVE' | 'DISABLED' = 'ACTIVE';
  agentVersion = 1;
  businessMinimum = '100.00';
  businessVersion = 1;
  commissionHistoryDeep = false;
  commissionSkuVersions: number[] = [];
  commissionVersion = 1;
  customerAgentId: string | null = AGENT_ID;
  customerVersion = 3;
  customersEmpty = false;
  deepPagination = false;
  productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST' = 'ALL_ACTIVE_PRODUCTS';
  productAuthorizationIds: string[] = [];
  productAuthorizationVersion = 1;
  payoutExpiresAt = LATER;
  refreshFails = false;
  uploadDigest: string | null = null;
  withdrawalStatus: 'APPROVED' | 'PAID' | 'PENDING' = 'PENDING';
  withdrawalVersion = 1;
  withdrawalHasProof = false;
  private createdAgent = false;
  private createReplayRedacted = false;

  async install(page: Page): Promise<void> {
    await page.route('https://uploads.example.test/**', async (route) => {
      const request = route.request();
      expect(request.method()).toBe('PUT');
      expect(request.headers()['content-type']).toBe('image/png');
      expect(request.headers()['x-amz-meta-sha256']).toBe(this.uploadDigest);
      await route.fulfill({ status: 200 });
    });
    await page.route('**/api/v1/**', (route) => this.handle(route));
  }

  enqueue(method: string, path: string, step: Step): void {
    const key = method + ' ' + path;
    const queue = this.steps.get(key) ?? [];
    queue.push(step);
    this.steps.set(key, queue);
  }

  callsFor(path: string, method?: string): Call[] {
    return this.calls.filter((call) => call.path === path && (method === undefined || call.method === method));
  }

  private record(route: Route): Call {
    const request = route.request();
    const url = new URL(request.url());
    const call: Call = {
      body: request.postData() ? request.postDataJSON() as Record<string, unknown> : null,
      headers: request.headers(),
      method: request.method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    };
    this.calls.push(call);
    return call;
  }

  private async applyStep(route: Route, call: Call): Promise<boolean> {
    const key = call.method + ' ' + call.path;
    const queue = this.steps.get(key);
    const step = queue?.shift();
    if (queue?.length === 0) this.steps.delete(key);
    if (!step) return false;
    if ('kind' in step && step.kind === 'DELAY') {
      await new Promise((resolve) => setTimeout(resolve, step.ms));
      return false;
    }
    if ('kind' in step) {
      if (step.kind === 'ABORT_COMMIT' && call.path === '/api/v1/admin/agents' && call.method === 'POST') {
        this.createdAgent = true;
        this.createReplayRedacted = true;
      }
      if (step.kind === 'ABORT_COMMIT' &&
          call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/proofs' && call.method === 'POST') {
        this.withdrawalHasProof = true;
        this.withdrawalVersion += 1;
      }
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

  private session() {
    return {
      access_token: ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      assurance: 'MFA',
      expires_at: LATER,
      mfa_required: false,
      refresh_token: REFRESH_TOKEN,
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      session_id: SESSION_ID,
    };
  }

  private pagination(call: Call, total: number) {
    return {
      page: Number(call.query.page ?? 1),
      page_size: Number(call.query.page_size ?? 20),
      total,
    };
  }

  private pageItems<T>(call: Call, items: T[]): T[] {
    const page = Number(call.query.page ?? 1);
    const pageSize = Number(call.query.page_size ?? 20);
    return items.slice((page - 1) * pageSize, page * pageSize);
  }

  private agent(agentId = AGENT_ID, name = 'Development agent') {
    return {
      agent_id: agentId,
      agent_no: agentId === AGENT_ID ? 'AG0001' : agentId === SECOND_AGENT_ID ? 'AG0002' : 'AG0003',
      contact_name: 'Development contact',
      contact_phone_tail: '0000',
      name,
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: agentId === AGENT_ID ? this.agentStatus : 'ACTIVE',
      version: agentId === AGENT_ID ? this.agentVersion : 1,
    };
  }

  private agentListItem(agentId: string, name: string, accountId: string) {
    const item = this.agent(agentId, name);
    return {
      account_alias: name + ' account',
      account_id: accountId,
      active_customer_count: agentId === AGENT_ID ? 1 : 0,
      agent_id: item.agent_id,
      agent_no: item.agent_no,
      available_balance: '50.00',
      created_at: NOW,
      login_name: agentId === AGENT_ID ? 'agent.one' : agentId === SECOND_AGENT_ID ? 'agent.two' : 'agent.new',
      name: item.name,
      net_sales_amount: '120.00',
      product_authorization_mode: item.product_authorization_mode,
      status: item.status,
      version: item.version,
    };
  }

  private agentItems(): Array<Record<string, unknown>> {
    const items = [
      this.agentListItem(AGENT_ID, 'Development agent', AGENT_ACCOUNT_ID),
      this.agentListItem(SECOND_AGENT_ID, 'Second agent', SECOND_AGENT_ACCOUNT_ID),
    ];
    if (this.deepPagination) {
      for (let index = 3; index <= 101; index += 1) {
        const item = this.agentListItem(
          index === 101 ? PAGE_TWO_AGENT_ID : fixtureUlid(10_000 + index),
          index === 101 ? 'Page 2 agent' : `Pagination agent ${index}`,
          fixtureUlid(11_000 + index),
        );
        item.agent_no = `AG${String(index).padStart(4, '0')}`;
        item.login_name = `agent.page.${index}`;
        items.push(item);
      }
    }
    if (this.createdAgent) {
      items.push(this.agentListItem(NEW_AGENT_ID, 'New development agent', NEW_AGENT_ACCOUNT_ID));
    }
    return items;
  }

  private productItems(): Array<Record<string, unknown>> {
    if (!this.deepPagination) return [];
    return Array.from({ length: 101 }, (_, offset) => {
      const index = offset + 1;
      return {
        product: {
          name: index === 101 ? 'Page 2 product' : `Pagination product ${index}`,
          product_id: index === 101 ? PAGE_TWO_PRODUCT_ID : fixtureUlid(20_000 + index),
          spu_code: `SPU${String(index).padStart(4, '0')}`,
        },
        skus: [],
      };
    });
  }

  private commissionItems(): Array<Record<string, unknown>> {
    if (!this.deepPagination) return [];
    return Array.from({ length: 21 }, (_, offset) => {
      const index = offset + 1;
      return {
        agent_id: AGENT_ID,
        available_change: '0.50',
        category_id: CATEGORY_ID,
        category_name: 'Development category',
        commission_base: '10.00',
        commission_snapshot_id: fixtureUlid(30_000 + index),
        effective_rate: '5.0000',
        expected_change: '0.00',
        expected_remaining: '0.00',
        ledger_id: fixtureUlid(31_000 + index),
        ledger_type: 'AVAILABLE_CREDIT',
        occurred_at: NOW,
        order_id: fixtureUlid(32_000 + index),
        order_item_id: fixtureUlid(33_000 + index),
        order_no: `ORDER-${String(index).padStart(4, '0')}`,
        original_commission: '0.50',
        position_state: 'AVAILABLE',
        product_id: fixtureUlid(34_000 + index),
        product_name: 'Development product',
        refund_id: null,
        reversal_total: '0.00',
        rule_source: 'PLATFORM',
        rule_version_id: RULE_VERSION_ID,
        rule_version_no: 1,
        sku_id: fixtureUlid(35_000 + index),
        sku_name: `SKU ${index}`,
      };
    });
  }

  private walletItems(): Array<Record<string, unknown>> {
    if (!this.deepPagination) return [];
    return Array.from({ length: 21 }, (_, offset) => {
      const index = offset + 1;
      return {
        agent_id: AGENT_ID,
        available_balance_after: '50.00',
        available_change: '0.50',
        expected_balance_after: '0.00',
        expected_change: '0.00',
        frozen_balance_after: '0.00',
        frozen_change: '0.00',
        ledger_type: 'AVAILABLE_CREDIT',
        occurred_at: NOW,
        reference_id: fixtureUlid(36_000 + index),
        reference_type: 'COMMISSION_LEDGER',
        refund_id: null,
        wallet_ledger_id: fixtureUlid(37_000 + index),
      };
    });
  }

  private customer() {
    return {
      account_status: 'ACTIVE',
      binding: this.customerAgentId === null ? null : {
        agent_id: this.customerAgentId,
        agent_name: this.customerAgentId === AGENT_ID ? 'Development agent' : 'Second agent',
        binding_id: BINDING_ID,
        customer_id: CUSTOMER_ID,
        customer_version: this.customerVersion,
        started_at: NOW,
      },
      city: 'Development city',
      consumption_amount: '12.00',
      consumption_count: 2,
      customer_alias: 'Customer 001',
      customer_id: CUSTOMER_ID,
      deletion_request_status: null,
      last_order_id: null,
      last_product_name: 'Development product',
      last_purchase_at: NOW,
      management_note_present: false,
      nickname_masked: 'D***',
      phone_masked: '138****0000',
      registered_at: NOW,
      version: this.customerVersion,
    };
  }

  private agentDetail() {
    return {
      agent: this.agent(),
      invite_code: {
        code_masked: 'INV***RST',
        expires_at: null,
        invite_code_id: INVITE_ID,
        status: 'ACTIVE',
        version: 1,
      },
      operating_summary: {
        active_customer_count: 1,
        net_sales_amount: '120.00',
        new_binding_count: 1,
        paid_order_count: 2,
      },
      wallet_summary: {
        available_balance: '50.00',
        expected_commission: '5.00',
        frozen_balance: '0.00',
        negative_balance: '0.00',
        version: 1,
      },
      withdrawal_summary: {
        approved_count: 0,
        latest_withdrawal_at: null,
        paid_count: 0,
        pending_count: 1,
        total_paid_amount: '0.00',
      },
    };
  }

  private preview(version: number, allowZero = false) {
    return {
      confirmation_hash: 'a'.repeat(64),
      expires_at: LATER,
      impact: {
        affected_count: 1,
        metrics: [{ after: 'new', before: 'old', key: 'status', label: '状态' }],
        warnings: [],
      },
      preview_token: PREVIEW_TOKEN,
      resource_etag: '"' + (allowZero ? 0 : version) + '"',
    };
  }

  private commissionRules() {
    const versionId = this.commissionVersion === 1 ? RULE_VERSION_ID : NEXT_RULE_VERSION_ID;
    return {
      categories: [{
        category_id: CATEGORY_ID,
        category_name: 'Development category',
        configured_rate: null,
        effective_rate: '5.0000',
        source: 'PLATFORM',
      }, {
        category_id: SECOND_CATEGORY_ID,
        category_name: 'Second category',
        configured_rate: null,
        effective_rate: '5.0000',
        source: 'PLATFORM',
      }],
      items: [],
      platform_rate: '5.0000',
      version: this.commissionVersion,
      version_id: versionId,
      version_no: this.commissionVersion,
    };
  }

  private commissionVersionView(
    versionId = this.commissionVersion === 1 ? RULE_VERSION_ID : NEXT_RULE_VERSION_ID,
    versionNo = this.commissionVersion,
    reason = this.commissionVersion === 1 ? 'Initial development rules' : 'Publish controlled rules',
  ) {
    return {
      base_version_id: versionNo === 1 ? null : RULE_VERSION_ID,
      changes: [
        { configured_rate: '5.0000', target_id: null, target_type: 'PLATFORM' },
        { configured_rate: null, target_id: CATEGORY_ID, target_type: 'CATEGORY' },
        { configured_rate: '0.0000', target_id: SKU_ID, target_type: 'SKU' },
      ],
      created_at: NOW,
      created_by_account_id: ACCOUNT_ID,
      effective_at: NOW,
      reason,
      status: 'PUBLISHED',
      version_id: versionId,
      version_no: versionNo,
    };
  }

  private commissionExplanation() {
    return {
      items: [{
        category_id: SECOND_CATEGORY_ID,
        category_name: 'Second category',
        commission_base: '100.00',
        commission_snapshot_id: EXPLANATION_SNAPSHOT_ID,
        effective_rate: '5.0000',
        expected_remaining: '5.00',
        hit_path: ['V1', 'SKU inherited', 'Category inherited', 'Platform 5.0000%'],
        ledger: [{
          available_change: '0.00',
          expected_change: '5.00',
          frozen_change: '0.00',
          ledger_id: EXPLANATION_LEDGER_ID,
          ledger_type: 'EXPECTED_CREATED',
          occurred_at: NOW,
          reason: 'Payment commission snapshot created',
          refund_id: null,
        }],
        order_item_id: EXPLANATION_ORDER_ITEM_ID,
        original_commission: '5.00',
        position_state: 'EXPECTED',
        product_id: EXPLANATION_PRODUCT_ID,
        product_name: 'Inherited product',
        reversal_total: '0.00',
        rounding_mode: 'HALF_UP',
        rounding_scale: 2,
        rule_source: 'PLATFORM',
        rule_version_id: RULE_VERSION_ID,
        rule_version_no: 1,
        sku_id: SECOND_SKU_ID,
        sku_name: 'Inherited SKU',
      }],
      order_id: EXPLANATION_ORDER_ID,
      order_no: 'ORDER-COMMISSION-001',
    };
  }

  private withdrawal() {
    return {
      agent_id: AGENT_ID,
      agent_name: 'Development agent',
      agent_no: 'AG0001',
      amount: '10.00',
      created_at: NOW,
      paid_at: this.withdrawalStatus === 'PAID' ? LATER : null,
      payout_account_snapshot: {
        account_holder_masked: 'D***',
        account_no_last4: '1234',
        account_number_masked: '******1234',
        bank_name: 'Development Bank',
        snapshot_at: NOW,
      },
      proof_file_ids: this.withdrawalHasProof ? [PROOF_ID] : [],
      request_balance_snapshot: {
        available_after: '90.00',
        available_before: '100.00',
        captured_at: NOW,
        frozen_after: '10.00',
        frozen_before: '0.00',
      },
      review_reason: null,
      reviewed_at: this.withdrawalStatus === 'PENDING' ? null : NOW,
      status: this.withdrawalStatus,
      version: this.withdrawalVersion,
      withdrawal_id: WITHDRAWAL_ID,
      withdrawal_no: 'WD0001',
    };
  }

  private businessRules() {
    return {
      aftersale_window_days: 7,
      effective_at: NOW,
      legal_record_retention_years: 7,
      minimum_withdrawal_amount: this.businessMinimum,
      order_payment_timeout_minutes: 30,
      version: this.businessVersion,
      version_id: this.businessVersion === 1 ? RULE_VERSION_ID : NEXT_RULE_VERSION_ID,
      version_no: this.businessVersion,
    };
  }

  private auditLog(call: Call) {
    return {
      action: 'UPDATE',
      actor_account_id: ACCOUNT_ID,
      actor_role: 'SUPER_ADMIN',
      after_summary: [{ display_value: 'DISABLED', field: 'status', sensitive: false }],
      after_version: 2,
      audit_id: AUDIT_ID,
      before_summary: [{ display_value: '发生变化', field: 'account_number', sensitive: true }],
      before_version: 1,
      created_at: NOW,
      idempotency_key: '00000000-0000-4000-8000-000000000001',
      ip_hash: 'hash_only_1234567',
      module: 'AGENT',
      reason: 'Development operation',
      request_id: 'req_b13_audit',
      result: 'SUCCESS',
      result_code: 'OK',
      target_id: call.query.target_id ?? AGENT_ID,
      target_type: call.query.target_type ?? 'AGENT',
    };
  }

  private async handle(route: Route): Promise<void> {
    const call = this.record(route);
    if (call.path === '/api/v1/admin/auth/login' && call.method === 'POST') {
      await fulfill(route, 200, success({
        assurance: 'PASSWORD_ONLY',
        challenge_id: 'b13-admin-login',
        expires_at: LATER,
        mfa_required: true,
        next_action: 'VERIFY_TOTP',
        pre_auth_token: PREAUTH_TOKEN,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/auth/mfa/challenges/b13-admin-login/verify' && call.method === 'POST') {
      expect(call.headers.authorization).toBe('Bearer ' + PREAUTH_TOKEN);
      await fulfill(route, 200, success(this.session()));
      return;
    }
    if (call.path === '/api/v1/admin/auth/refresh' && call.method === 'POST') {
      await fulfill(
        route,
        this.refreshFails ? 401 : 200,
        this.refreshFails ? failure('AUTH_EXPIRED') : success(this.session()),
      );
      return;
    }

    expect(call.headers.authorization).toBe('Bearer ' + ACCESS_TOKEN);
    if (await this.applyStep(route, call)) return;

    if (call.path === '/api/v1/admin/brands' && call.method === 'GET') {
      await fulfill(route, 200, success({ items: [], pagination: this.pagination(call, 0) }));
      return;
    }
    if (call.path === '/api/v1/admin/auth/current' && call.method === 'GET') {
      await fulfill(route, 200, success({
        account_id: ACCOUNT_ID,
        assurance: 'MFA',
        mfa_verified_at: NOW,
        permissions: ['admin:security:read'],
        restriction: 'NONE',
        role: 'SUPER_ADMIN',
        session_id: SESSION_ID,
        status: 'ACTIVE',
        version: 3,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/customers' && call.method === 'GET') {
      const items = this.customersEmpty ? [] : [this.customer()];
      await fulfill(route, 200, success({ items, pagination: this.pagination(call, items.length) }));
      return;
    }
    if (call.path === '/api/v1/admin/orders' && call.method === 'GET') {
      await fulfill(route, 200, success({ items: [], pagination: this.pagination(call, 0) }));
      return;
    }
    if (call.path === '/api/v1/admin/customers/' + CUSTOMER_ID && call.method === 'GET') {
      await fulfill(route, 200, success({ binding_history: [], customer: this.customer(), orders: [] }));
      return;
    }
    if (call.path === '/api/v1/admin/customers/' + CUSTOMER_ID + '/attribution-transfer-preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.customerVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/customers/' + CUSTOMER_ID + '/attribution-transfers' && call.method === 'POST') {
      expect(call.headers['if-match']).toBe('"' + this.customerVersion + '"');
      this.customerAgentId = String(call.body?.target_agent_id);
      this.customerVersion += 1;
      await fulfill(route, 200, success(this.customer()));
      return;
    }
    if (call.path === '/api/v1/admin/agents' && call.method === 'GET') {
      const items = this.agentItems().filter((item) => call.query.status !== 'ACTIVE' || item.status === 'ACTIVE');
      await fulfill(route, 200, success({ items: this.pageItems(call, items), pagination: this.pagination(call, items.length) }));
      return;
    }
    if (call.path === '/api/v1/admin/agents' && call.method === 'POST') {
      this.createdAgent = true;
      if (this.createReplayRedacted) {
        this.createReplayRedacted = false;
        await fulfill(route, 201, success({
          agent: this.agent(NEW_AGENT_ID, 'New development agent'),
          disclosure_state: 'REPLAY_REDACTED',
          expires_at: null,
          initial_invite_code: null,
          must_change_password: true,
          reissue_required: true,
          temporary_password: null,
        }));
        return;
      }
      await fulfill(route, 201, success({
        agent: this.agent(NEW_AGENT_ID, 'New development agent'),
        disclosure_state: 'FIRST_ISSUE',
        expires_at: LATER,
        initial_invite_code: {
          code: INITIAL_INVITE_CODE,
          expires_at: LATER,
          invite_code_id: NEW_INVITE_ID,
          status: 'ACTIVE',
          version: 1,
        },
        must_change_password: true,
        reissue_required: false,
        temporary_password: TEMPORARY_PASSWORD,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID && call.method === 'GET') {
      await fulfill(route, 200, success(this.agentDetail()));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/product-authorization' && call.method === 'GET') {
      await fulfill(route, 200, success({
        agent_id: AGENT_ID,
        mode: this.productAuthorizationMode,
        product_ids: this.productAuthorizationIds,
        version: this.productAuthorizationVersion,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/product-authorization' && call.method === 'PATCH') {
      expect(call.headers['if-match']).toBe(`"${this.productAuthorizationVersion}"`);
      this.productAuthorizationMode = call.body?.mode as 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';
      this.productAuthorizationIds = [...(call.body?.product_ids as string[])];
      this.productAuthorizationVersion += 1;
      await fulfill(route, 200, success({
        agent_id: AGENT_ID,
        mode: this.productAuthorizationMode,
        product_ids: this.productAuthorizationIds,
        version: this.productAuthorizationVersion,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/commissions' && call.method === 'GET') {
      const items = this.commissionItems();
      await fulfill(route, 200, success({ items: this.pageItems(call, items), pagination: this.pagination(call, items.length) }));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/wallet-ledger' && call.method === 'GET') {
      const items = this.walletItems();
      await fulfill(route, 200, success({ items: this.pageItems(call, items), pagination: this.pagination(call, items.length) }));
      return;
    }
    if (call.path === '/api/v1/admin/products' && call.method === 'GET') {
      const items = this.productItems();
      await fulfill(route, 200, success({ items: this.pageItems(call, items), pagination: this.pagination(call, items.length) }));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/status-change-preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.agentVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/agents/' + AGENT_ID + '/status-changes' && call.method === 'POST') {
      expect(call.headers['if-match']).toBe('"' + this.agentVersion + '"');
      this.agentStatus = 'DISABLED';
      this.agentVersion += 1;
      await fulfill(route, 200, success({
        occurred_at: NOW,
        resource_id: AGENT_ID,
        resource_type: 'AGENT',
        status: 'DISABLED',
        version: this.agentVersion,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/commission-rules/current' && call.method === 'GET') {
      await fulfill(route, 200, success(this.commissionRules()));
      return;
    }
    if (call.path === '/api/v1/admin/commission-rules/skus' && call.method === 'GET') {
      const skuVersion = this.commissionSkuVersions.shift() ?? this.commissionVersion;
      const items = [
        {
          category_id: CATEGORY_ID,
          configured_rate: '0.0000',
          effective_rate: '0.0000',
          product_name: 'Zero-rate product',
          sku_code: 'SKU-ZERO',
          sku_id: SKU_ID,
          source: 'SKU',
        },
        {
          category_id: SECOND_CATEGORY_ID,
          configured_rate: null,
          effective_rate: '5.0000',
          product_name: 'Inherited product',
          sku_code: 'SKU-INHERIT',
          sku_id: SECOND_SKU_ID,
          source: 'PLATFORM',
        },
      ];
      await fulfill(route, 200, success({
        items,
        pagination: this.pagination(call, items.length),
        version_id: skuVersion === 1 ? RULE_VERSION_ID : NEXT_RULE_VERSION_ID,
        version_no: skuVersion,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/commission-rule-versions' && call.method === 'GET') {
      const items = this.commissionHistoryDeep
        ? Array.from({ length: 21 }, (_, index) => {
            const versionNo = 21 - index;
            const versionId = versionNo === 1
              ? PAGE_TWO_RULE_VERSION_ID
              : versionNo === 21
                ? NEXT_RULE_VERSION_ID
                : fixtureUlid(50_000 + versionNo);
            return this.commissionVersionView(
              versionId,
              versionNo,
              versionNo === 1 ? 'Oldest development rules' : `Development rules V${versionNo}`,
            );
          })
        : [this.commissionVersionView()];
      await fulfill(route, 200, success({
        items: this.pageItems(call, items),
        pagination: this.pagination(call, items.length),
      }));
      return;
    }
    if (call.path.startsWith('/api/v1/admin/commission-rule-versions/') && call.method === 'GET') {
      const versionId = call.path.slice('/api/v1/admin/commission-rule-versions/'.length);
      const version = versionId === PAGE_TWO_RULE_VERSION_ID
        ? this.commissionVersionView(PAGE_TWO_RULE_VERSION_ID, 1, 'Oldest development rules')
        : this.commissionVersionView();
      await fulfill(route, 200, success(version));
      return;
    }
    if (call.path === '/api/v1/admin/orders/' + EXPLANATION_ORDER_ID + '/commission-explanation' && call.method === 'GET') {
      await fulfill(route, 200, success(this.commissionExplanation()));
      return;
    }
    if (call.path === '/api/v1/admin/commission-rule-versions/preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.commissionVersion, this.commissionVersion === 0)));
      return;
    }
    if (call.path === '/api/v1/admin/commission-rule-versions' && call.method === 'POST') {
      this.commissionVersion += 1;
      await fulfill(route, 200, success(this.commissionVersionView()));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals' && call.method === 'GET') {
      await fulfill(route, 200, success({
        items: [this.withdrawal()],
        pagination: this.pagination(call, 1),
      }));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID && call.method === 'GET') {
      await fulfill(route, 200, success(this.withdrawal()));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/approve-preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.withdrawalVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/approve' && call.method === 'POST') {
      this.withdrawalStatus = 'APPROVED';
      this.withdrawalVersion += 1;
      await fulfill(route, 200, success(this.withdrawal()));
      return;
    }
    if (call.path === '/api/v1/admin/auth/reauth' && call.method === 'POST') {
      await fulfill(route, 200, success({
        expires_at: LATER,
        reauth_grant: 'reauth_b13_single_use',
        single_use: true,
        withdrawal_id: WITHDRAWAL_ID,
      }));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/payout-account-reveal' && call.method === 'POST') {
      await fulfill(route, 200, success({
        account_holder: 'Development holder',
        account_number: RAW_PAYOUT_ACCOUNT,
        bank_name: 'Development Bank',
        expires_at: this.payoutExpiresAt,
      }));
      return;
    }
    if (call.path === '/api/v1/files/upload-intents' && call.method === 'POST') {
      expect(call.body).toMatchObject({
        mime_type: 'image/png',
        purpose: 'WITHDRAWAL_PROOF',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: PNG_BYTES.byteLength,
      });
      this.uploadDigest = String(call.body?.sha256);
      await fulfill(route, 200, success({
        expires_at: LATER,
        file_id: PROOF_ID,
        purpose: 'WITHDRAWAL_PROOF',
        status: 'PENDING',
        upload_headers: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'x-amz-meta-sha256', value: this.uploadDigest },
        ],
        upload_url: 'https://uploads.example.test/proof',
      }));
      return;
    }
    if (call.path === '/api/v1/files/' + PROOF_ID + '/complete' && call.method === 'POST') {
      await fulfill(route, 200, success({
        completed_at: NOW,
        file_id: PROOF_ID,
        public_url: null,
        purpose: 'WITHDRAWAL_PROOF',
        status: 'READY',
      }));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/proofs' && call.method === 'POST') {
      if (!this.withdrawalHasProof) {
        this.withdrawalHasProof = true;
        this.withdrawalVersion += 1;
      }
      await fulfill(route, 200, success(this.withdrawal()));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/mark-paid-preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.withdrawalVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/mark-paid' && call.method === 'POST') {
      this.withdrawalStatus = 'PAID';
      this.withdrawalVersion += 1;
      await fulfill(route, 200, success(this.withdrawal()));
      return;
    }
    if (call.path === '/api/v1/admin/audit-logs' && call.method === 'GET') {
      await fulfill(route, 200, success({
        items: [this.auditLog(call)],
        pagination: this.pagination(call, 1),
      }));
      return;
    }
    if (call.path === '/api/v1/admin/settings/business-rules' && call.method === 'GET') {
      await fulfill(route, 200, success(this.businessRules()));
      return;
    }
    if (call.path === '/api/v1/admin/settings/business-rules/preview' && call.method === 'POST') {
      await fulfill(route, 200, success(this.preview(this.businessVersion)));
      return;
    }
    if (call.path === '/api/v1/admin/settings/business-rules' && call.method === 'PATCH') {
      const changes = call.body?.changes as Record<string, unknown> | undefined;
      this.businessMinimum = String(changes?.minimum_withdrawal_amount ?? this.businessMinimum);
      this.businessVersion += 1;
      await fulfill(route, 200, success(this.businessRules()));
      return;
    }
    if (call.path === '/api/v1/admin/settings/return-address' && call.method === 'GET') {
      await fulfill(route, 404, failure('RETURN_ADDRESS_NOT_CONFIGURED'));
      return;
    }

    this.unhandled.push(call.method + ' ' + call.path);
    await fulfill(route, 500, failure('UNHANDLED_TEST_REQUEST'));
  }
}

async function signIn(page: Page, backend: MockAdminWorkbenchBackend): Promise<void> {
  await backend.install(page);
  await page.goto('/login');
  await page.getByLabel('超级管理员账号').fill('b13.admin');
  await page.getByLabel('登录密码').fill(['Admin', 'B13', 'Password'].join('-'));
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

function stateMatrixProject(projectName: string): boolean {
  return projectName === 'mobile-390' || projectName === 'web-1024';
}

async function openNavigation(page: Page, title: string, path: RegExp): Promise<void> {
  await page.getByTitle(title).click();
  await expect(page).toHaveURL(path);
}

async function previewAndConfirm(
  page: Page,
  confirmLabel: string,
  reason = 'Controlled development operation',
): Promise<void> {
  const dialog = page.locator('.el-dialog:visible').last();
  const reasonInput = dialog.getByPlaceholder('说明本次操作原因');
  if (await reasonInput.count()) await reasonInput.fill(reason);
  await dialog.getByRole('button', { name: '生成操作预览' }).click();
  await expect(dialog.getByTestId('b13-command-preview')).toBeVisible();
  await dialog.getByRole('button', { name: confirmLabel }).click();
  await expect(dialog).toBeHidden();
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(dimensions.body, dimensions.document)).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function chooseSelectOption(page: Page, select: Locator, option: string): Promise<void> {
  await select.click();
  await page.locator('.el-select-dropdown:visible').getByText(option, { exact: true }).click();
}

async function tamperDisabledInput(input: Locator, value: string): Promise<void> {
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement;
    target.disabled = false;
    target.value = nextValue;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5280' });
}

test('ADM-14..22 completes the Admin agent-finance workbench at every viewport', async ({ context, page }) => {
  const backend = new MockAdminWorkbenchBackend();
  await grantClipboard(context);
  await signIn(page, backend);

  await openNavigation(page, '客户管理', /\/customers$/);
  await expect(page.getByTestId('admin-customer-list-page')).toBeVisible();
  await expect(page.getByText('Customer 001', { exact: true })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Customer 001' }).getByRole('button', { name: '详情' }).click();
  await expect(page).toHaveURL(new RegExp('/customers/' + CUSTOMER_ID + '$'));
  await expect(page.getByTestId('admin-customer-detail-page')).toBeVisible();
  await chooseSelectOption(page, page.locator('.attribution-controls .el-select'), 'AG0002 · Second agent');
  await page.getByTestId('customer-transfer-open').click();
  await previewAndConfirm(page, '确认变更归属');
  await expect(page.getByText('Second agent', { exact: true }).first()).toBeVisible();
  const transfers = backend.callsFor(
    '/api/v1/admin/customers/' + CUSTOMER_ID + '/attribution-transfers',
    'POST',
  );
  expect(transfers).toHaveLength(1);
  expect(transfers[0]?.body).toMatchObject({
    confirmation_hash: 'a'.repeat(64),
    preview_token: PREVIEW_TOKEN,
    target_agent_id: SECOND_AGENT_ID,
  });

  await openNavigation(page, '代理管理', /\/agents$/);
  await expect(page.getByTestId('admin-agent-list-page')).toBeVisible();
  await page.getByTestId('agent-create-open').click();
  await page.getByLabel('代理名称').fill('New development agent');
  await page.getByLabel('登录账号').fill('agent.new');
  await page.getByLabel('联系人').fill('New contact');
  await page.getByLabel('联系电话（可选）').fill(CONTACT_PHONE);
  await page.getByRole('button', { name: '创建并签发凭据' }).click();
  await expect(page.getByTestId('agent-temporary-password')).toHaveText(TEMPORARY_PASSWORD);
  await expect(page.getByTestId('agent-initial-invite-code')).toHaveText(INITIAL_INVITE_CODE);
  await page.getByRole('button', { name: '我已完成交接并清除' }).click();
  await expect(page.getByText(TEMPORARY_PASSWORD, { exact: true })).toHaveCount(0);
  await expect(page.getByText(INITIAL_INVITE_CODE, { exact: true })).toHaveCount(0);

  await page.getByRole('row').filter({ hasText: 'AG0001' }).getByRole('button', { name: '详情' }).click();
  await expect(page).toHaveURL(new RegExp('/agents/' + AGENT_ID + '$'));
  await expect(page.getByTestId('admin-agent-detail-page')).toBeVisible();
  await page.locator('.heading-actions').getByRole('button', { name: '停用' }).click();
  await previewAndConfirm(page, '确认停用');
  await expect(page.getByText('已停用', { exact: true }).first()).toBeVisible();
  expect(backend.callsFor('/api/v1/admin/agents/' + AGENT_ID + '/status-changes', 'POST')).toHaveLength(1);

  await page.getByRole('link', { name: '审计下钻' }).click();
  await expect(page).toHaveURL(new RegExp('/audit-logs\\?target_type=agent&target_id=' + AGENT_ID));
  await expect(page.getByTestId('audit-target-lock')).toContainText(AGENT_ID);
  await expect(page.getByPlaceholder('目标类型')).toBeDisabled();
  await expect(page.getByPlaceholder('目标 ID')).toBeDisabled();
  await page.locator('.el-table__expand-icon').click();
  await expect(page.getByTestId('audit-summary')).toContainText('发生变化');
  await expect(page.getByTestId('audit-summary')).not.toContainText(RAW_PAYOUT_ACCOUNT);
  const lockedAuditCall = backend.callsFor('/api/v1/admin/audit-logs', 'GET').at(-1);
  expect(lockedAuditCall?.query).toMatchObject({ target_id: AGENT_ID, target_type: 'agent' });

  await openNavigation(page, '佣金规则', /\/commission-rules$/);
  await expect(page.getByTestId('admin-commission-rules-page')).toBeVisible();
  await expect(page.getByText('0.0000%', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('继承', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('目标 ULID')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'SKU-INHERIT' })).toContainText('Second category');

  await page.getByTestId('commission-version-view-' + RULE_VERSION_ID).click();
  const versionDialog = page.locator('.el-dialog:visible').last();
  await expect(versionDialog.getByTestId('commission-version-detail')).toContainText('Initial development rules');
  await expect(versionDialog).toContainText('Development category');
  await expect(versionDialog).toContainText('SKU-ZERO · Zero-rate product');
  expect(backend.callsFor('/api/v1/admin/commission-rule-versions/' + RULE_VERSION_ID, 'GET')).toHaveLength(1);
  await versionDialog.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel('订单 ID').fill(EXPLANATION_ORDER_ID);
  await page.getByTestId('commission-explanation-load').click();
  const explanationResult = page.getByTestId('commission-explanation-result');
  await expect(page.locator('.explanation-summary')).toContainText('ORDER-COMMISSION-001');
  await expect(explanationResult).toContainText('Inherited product');
  await expect(explanationResult).toContainText('5.0000%');
  await explanationResult.locator('.el-table__expand-icon').click();
  await expect(explanationResult).toContainText('Second category');
  await expect(explanationResult).toContainText('Platform 5.0000%');
  await expect(explanationResult).toContainText('基数 ¥100.00 × 比例 5.0000% / 100 = 原始佣金 ¥5.00');
  await expect(explanationResult).toContainText('HALF_UP · 2 位');
  await expect(explanationResult).toContainText('EXPECTED_CREATED');
  expect(backend.callsFor(
    '/api/v1/admin/orders/' + EXPLANATION_ORDER_ID + '/commission-explanation',
    'GET',
  )).toHaveLength(1);

  await page.getByTestId('commission-platform-edit').click();
  await page.getByPlaceholder('比例 0-100').fill('10');
  await page.getByRole('button', { name: '加入变更' }).click();
  await page.getByTestId('commission-category-edit-' + CATEGORY_ID).click();
  await page.getByPlaceholder('比例 0-100').fill('2');
  await page.getByRole('button', { name: '加入变更' }).click();
  await page.getByTestId('commission-sku-edit-' + SECOND_SKU_ID).click();
  await page.getByPlaceholder('比例 0-100').fill('0');
  await page.getByRole('button', { name: '加入变更' }).click();
  await page.getByTestId('commission-publish-open').click();
  await previewAndConfirm(page, '确认发布新版本');
  const commissionPreview = backend.callsFor('/api/v1/admin/commission-rule-versions/preview', 'POST').at(-1);
  expect(commissionPreview?.body).toMatchObject({
    base_version_id: RULE_VERSION_ID,
    changes: [
      { configured_rate: '10.0000', target_id: null, target_type: 'PLATFORM' },
      { configured_rate: '2.0000', target_id: CATEGORY_ID, target_type: 'CATEGORY' },
      { configured_rate: '0.0000', target_id: SECOND_SKU_ID, target_type: 'SKU' },
    ],
  });
  await expectNoPageOverflow(page);

  await openNavigation(page, '提现审核', /\/withdrawals$/);
  await expect(page.getByTestId('admin-withdrawal-list-page')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'WD0001' }).getByRole('button', { name: '处理' }).click();
  await expect(page).toHaveURL(new RegExp('/withdrawals/' + WITHDRAWAL_ID + '$'));
  await page.getByTestId('withdrawal-approve-open').click();
  await previewAndConfirm(page, '确认批准');
  await expect(page.getByRole('button', { name: 'TOTP 查看完整收款账号' })).toBeVisible();

  await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
  await page.getByLabel('当前 TOTP 动态验证码').fill('123456');
  await page.getByRole('button', { name: '验证并单次查看' }).click();
  await expect(page.getByTestId('payout-account-number')).toHaveText(RAW_PAYOUT_ACCOUNT);
  await page.getByRole('button', { name: '复制账号并清除' }).click();
  await expect(page.getByText(RAW_PAYOUT_ACCOUNT, { exact: true })).toHaveCount(0);
  expect(backend.callsFor(
    '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/payout-account-reveal',
    'POST',
  )).toHaveLength(1);

  await page.locator('input[type="file"][aria-label="选择付款凭证"]').setInputFiles({
    buffer: PNG_BYTES,
    mimeType: 'image/png',
    name: 'payment-proof.png',
  });
  await expect(page.getByText(PROOF_ID, { exact: true })).toBeVisible();
  await page.getByTestId('withdrawal-paid-open').click();
  const paidDialog = page.locator('.el-dialog:visible').last();
  await paidDialog.getByRole('button', { name: '生成操作预览' }).click();
  await expect(paidDialog.getByTestId('b13-command-preview')).toBeVisible();
  const previewStorage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? '';
      return [key, sessionStorage.getItem(key) ?? ''];
    }),
  ));
  expect(previewStorage).not.toHaveProperty('qingxu.admin.withdrawal-paid.v1');
  expect(Object.values(previewStorage).join('\n')).not.toContain(PREVIEW_TOKEN);
  await paidDialog.getByRole('button', { name: '确认已付款' }).click();
  await expect(paidDialog).toBeHidden();
  await expect(page.getByText('PAID', { exact: true })).toBeVisible();
  const completedStorage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? '';
      return [key, sessionStorage.getItem(key) ?? ''];
    }),
  ));
  expect(completedStorage).not.toHaveProperty('qingxu.admin.withdrawal-paid.v1');
  expect(Object.values(completedStorage).join('\n')).not.toContain(PREVIEW_TOKEN);
  const paidCall = backend.callsFor(
    '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/mark-paid',
    'POST',
  ).at(-1);
  expect(paidCall?.body).toMatchObject({ proof_file_ids: [PROOF_ID] });

  await openNavigation(page, '账户安全', /\/settings\/account\/security$/);
  await expect(page.getByTestId('business-rules-panel')).toBeVisible();
  await expect(page.getByText('30 分钟', { exact: true })).toBeVisible();
  await expect(page.getByText('7 年', { exact: true })).toBeVisible();
  const minimum = page.getByTestId('business-rules-minimum');
  await minimum.fill('120.00');
  await page.getByTestId('business-rules-open').click();
  await previewAndConfirm(page, '确认发布');
  await expect(minimum).toHaveValue('120.00');
  const businessCall = backend.callsFor('/api/v1/admin/settings/business-rules', 'PATCH').at(-1);
  expect(businessCall?.body).toMatchObject({
    changes: { minimum_withdrawal_amount: '120.00' },
    confirmation_hash: 'a'.repeat(64),
    preview_token: PREVIEW_TOKEN,
  });

  await expectNoPageOverflow(page);
  expect(backend.unhandled).toEqual([]);
});

test('agent drill-down locks its context and exposes records beyond the first page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web-1024', 'Focused pagination and context-integrity regression.');
  const backend = new MockAdminWorkbenchBackend();
  backend.deepPagination = true;
  await signIn(page, backend);

  await openNavigation(page, '客户管理', /\/customers$/);
  await page.getByRole('row').filter({ hasText: 'Customer 001' }).getByRole('button', { name: '详情' }).click();
  await chooseSelectOption(page, page.locator('.attribution-controls .el-select'), 'AG0101 · Page 2 agent');
  expect(backend.callsFor('/api/v1/admin/agents', 'GET').map((call) => call.query.page)).toEqual(['1', '2']);

  await openNavigation(page, '代理管理', /\/agents$/);
  await page.getByRole('row').filter({ hasText: 'AG0001' }).getByRole('button', { name: '详情' }).click();
  await expect(page.getByTestId('admin-agent-detail-page')).toBeVisible();
  await expect(page.getByTestId('agent-commission-pagination')).toContainText('第 1 / 2 页');
  await expect(page.getByTestId('agent-wallet-pagination')).toContainText('第 1 / 2 页');
  expect(backend.callsFor('/api/v1/admin/products', 'GET').map((call) => call.query.page)).toEqual(['1', '2']);

  await page.getByRole('button', { name: '商品授权' }).click();
  await page.getByText('指定商品白名单', { exact: true }).click();
  await page.locator('.el-dialog:visible .el-select').click();
  await expect(page.locator('.el-select-dropdown:visible').getByText('SPU0101 · Page 2 product', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存授权' }).click();
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0);
  expect(backend.callsFor('/api/v1/admin/agents/' + AGENT_ID + '/product-authorization', 'PATCH').at(-1)?.body)
    .toEqual({ mode: 'CUSTOM_WHITELIST', product_ids: [] });

  await page.getByTestId('agent-commission-pagination').locator('.el-pager li').filter({ hasText: '2' }).click();
  await expect(page.getByText('ORDER-0021', { exact: true })).toBeVisible();
  expect(backend.callsFor('/api/v1/admin/agents/' + AGENT_ID + '/commissions', 'GET').at(-1)?.query.page).toBe('2');
  await page.getByTestId('agent-wallet-pagination').locator('.el-pager li').filter({ hasText: '2' }).click();
  await expect(page.getByTestId('agent-wallet-pagination')).toContainText('第 2 / 2 页');
  expect(backend.callsFor('/api/v1/admin/agents/' + AGENT_ID + '/wallet-ledger', 'GET').at(-1)?.query.page).toBe('2');

  await page.getByRole('link', { name: '客户下钻' }).click();
  await expect(page.getByTestId('customer-agent-lock')).toContainText(AGENT_ID);
  const customerAgent = page.getByPlaceholder('代理 ULID');
  await expect(customerAgent).toBeDisabled();
  await tamperDisabledInput(customerAgent, SECOND_AGENT_ID);
  const customerCalls = backend.callsFor('/api/v1/admin/customers', 'GET').length;
  await page.getByTestId('customer-search').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/customers', 'GET').length).toBeGreaterThan(customerCalls);
  expect(backend.callsFor('/api/v1/admin/customers', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);
  await page.getByTestId('customer-reset').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/customers', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);

  await page.goBack();
  await expect(page.getByTestId('admin-agent-detail-page')).toBeVisible();
  await page.getByRole('link', { name: '订单下钻' }).click();
  await expect(page.getByTestId('order-agent-lock')).toContainText(AGENT_ID);
  await page.getByTestId('order-more-filters').click();
  const orderAgent = page.getByPlaceholder('最终代理 ULID');
  await expect(orderAgent).toBeDisabled();
  await tamperDisabledInput(orderAgent, SECOND_AGENT_ID);
  const orderCalls = backend.callsFor('/api/v1/admin/orders', 'GET').length;
  await page.getByTestId('order-apply-filters').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/orders', 'GET').length).toBeGreaterThan(orderCalls);
  expect(backend.callsFor('/api/v1/admin/orders', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);
  await page.getByTestId('order-reset-filters').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/orders', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);

  await page.goBack();
  await expect(page.getByTestId('admin-agent-detail-page')).toBeVisible();
  await page.getByRole('link', { name: '提现下钻' }).click();
  await expect(page.getByTestId('withdrawal-agent-lock')).toContainText(AGENT_ID);
  const withdrawalAgent = page.getByPlaceholder('代理 ULID');
  await expect(withdrawalAgent).toBeDisabled();
  await tamperDisabledInput(withdrawalAgent, SECOND_AGENT_ID);
  const withdrawalCalls = backend.callsFor('/api/v1/admin/withdrawals', 'GET').length;
  await page.getByRole('button', { name: '查询' }).click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/withdrawals', 'GET').length).toBeGreaterThan(withdrawalCalls);
  expect(backend.callsFor('/api/v1/admin/withdrawals', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);
  await page.getByTestId('withdrawal-reset').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/withdrawals', 'GET').at(-1)?.query.agent_id).toBe(AGENT_ID);

  await page.goBack();
  await expect(page.getByTestId('admin-agent-detail-page')).toBeVisible();
  await page.getByRole('link', { name: '审计下钻' }).click();
  await expect(page.getByTestId('audit-target-lock')).toContainText(AGENT_ID);
  const auditType = page.getByPlaceholder('目标类型');
  const auditId = page.getByPlaceholder('目标 ID');
  await expect(auditType).toBeDisabled();
  await expect(auditId).toBeDisabled();
  await tamperDisabledInput(auditType, 'withdrawal');
  await tamperDisabledInput(auditId, SECOND_AGENT_ID);
  const auditCalls = backend.callsFor('/api/v1/admin/audit-logs', 'GET').length;
  await page.getByTestId('audit-search').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/audit-logs', 'GET').length).toBeGreaterThan(auditCalls);
  expect(backend.callsFor('/api/v1/admin/audit-logs', 'GET').at(-1)?.query)
    .toMatchObject({ target_id: AGENT_ID, target_type: 'agent' });
  await page.getByTestId('audit-reset').click();
  await expect.poll(() => backend.callsFor('/api/v1/admin/audit-logs', 'GET').at(-1)?.query.target_id).toBe(AGENT_ID);

  backend.commissionHistoryDeep = true;
  await openNavigation(page, '佣金规则', /\/commission-rules$/);
  const history = page.getByTestId('commission-version-history');
  await history.getByTestId('commission-version-pagination').locator('.el-pager li').filter({ hasText: '2' }).click();
  await expect(history.getByTestId('commission-version-view-' + PAGE_TWO_RULE_VERSION_ID)).toBeVisible();
  expect(backend.callsFor('/api/v1/admin/commission-rule-versions', 'GET').at(-1)?.query)
    .toMatchObject({ page: '2', page_size: '20' });
  await history.getByTestId('commission-version-view-' + PAGE_TWO_RULE_VERSION_ID).click();
  await expect(page.getByTestId('commission-version-detail')).toContainText('Oldest development rules');
  expect(backend.callsFor(
    '/api/v1/admin/commission-rule-versions/' + PAGE_TWO_RULE_VERSION_ID,
    'GET',
  )).toHaveLength(1);

  expect(backend.unhandled).toEqual([]);
});

test('commission current and SKU projections retry one drifting snapshot then fail closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'web-1024', 'Focused commission snapshot consistency regression.');
  const backend = new MockAdminWorkbenchBackend();
  backend.commissionSkuVersions.push(2, 1);
  await signIn(page, backend);

  await openNavigation(page, '佣金规则', /\/commission-rules$/);
  await expect(page.getByTestId('commission-platform-edit')).toBeVisible();
  expect(backend.callsFor('/api/v1/admin/commission-rules/current', 'GET')).toHaveLength(2);
  expect(backend.callsFor('/api/v1/admin/commission-rules/skus', 'GET')).toHaveLength(2);

  backend.commissionSkuVersions.push(2, 2);
  await page.getByTestId('commission-refresh').click();
  await expect(page.getByText('佣金规则版本正在变化，无法安全展示，请稍后重试')).toBeVisible();
  await expect(page.getByTestId('commission-platform-edit')).toHaveCount(0);
  expect(backend.callsFor('/api/v1/admin/commission-rules/current', 'GET')).toHaveLength(4);
  expect(backend.callsFor('/api/v1/admin/commission-rules/skus', 'GET')).toHaveLength(4);
  expect(backend.unhandled).toEqual([]);
});

test('ADM workbench exposes representative loading, empty and read failure states', async ({ page }, testInfo) => {
  test.skip(!stateMatrixProject(testInfo.project.name), 'Focused state matrix runs at one mobile and one desktop width.');
  const backend = new MockAdminWorkbenchBackend();
  await signIn(page, backend);

  backend.enqueue('GET', '/api/v1/admin/customers', { kind: 'DELAY', ms: 1_500 });
  await openNavigation(page, '客户管理', /\/customers$/);
  await page.waitForTimeout(1_250);
  await expect(page.locator('.b13-state')).toBeVisible();
  await expect(page.getByText('Customer 001', { exact: true })).toBeVisible();

  backend.customersEmpty = true;
  backend.enqueue('GET', '/api/v1/admin/customers', { code: 'FORBIDDEN', status: 403 });
  await page.locator('.b13-results > header').getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('当前账号无权访问客户管理')).toBeVisible();
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByText('没有符合条件的客户')).toBeVisible();

  await openNavigation(page, '代理管理', /\/agents$/);
  await expect(page.getByRole('row').filter({ hasText: 'AG0001' })).toBeVisible();
  backend.enqueue('GET', '/api/v1/admin/agents/' + AGENT_ID, { code: 'NOT_FOUND', status: 404 });
  await page.getByRole('row').filter({ hasText: 'AG0001' }).getByRole('button', { name: '详情' }).click();
  await expect(page.getByText('代理不存在或已不可访问')).toBeVisible();

  backend.enqueue('GET', '/api/v1/admin/commission-rules/current', { code: 'SERVER_ERROR', status: 500 });
  await openNavigation(page, '佣金规则', /\/commission-rules$/);
  await expect(page.getByText('佣金规则加载失败，请稍后重试')).toBeVisible();

  backend.enqueue('GET', '/api/v1/admin/audit-logs', { code: 'RATE_LIMITED', retryAfter: 7, status: 429 });
  await openNavigation(page, '审计日志', /\/audit-logs$/);
  await expect(page.getByText('查询过于频繁，请在 7 秒后重试')).toBeVisible();
  backend.enqueue('GET', '/api/v1/admin/audit-logs', { code: 'SERVER_ERROR', status: 500 });
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByText('审计服务暂时不可用，请稍后重试')).toBeVisible();
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByText('1 条审计记录')).toBeVisible();

  backend.refreshFails = true;
  backend.enqueue('GET', '/api/v1/admin/withdrawals', { code: 'AUTH_EXPIRED', status: 401 });
  await page.getByTitle('提现审核').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(backend.callsFor('/api/v1/admin/auth/refresh', 'POST')).toHaveLength(1);
  expect(backend.unhandled).toEqual([]);
});

test('ADM commands fail closed on conflicts, validation, lost responses and double clicks', async ({ page }, testInfo) => {
  test.skip(!stateMatrixProject(testInfo.project.name), 'Focused command matrix runs at one mobile and one desktop width.');
  const backend = new MockAdminWorkbenchBackend();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  await signIn(page, backend);

  await openNavigation(page, '客户管理', /\/customers$/);
  await page.getByRole('row').filter({ hasText: 'Customer 001' }).getByRole('button', { name: '详情' }).click();
  await chooseSelectOption(page, page.locator('.attribution-controls .el-select'), 'AG0002 · Second agent');
  backend.enqueue(
    'POST',
    '/api/v1/admin/customers/' + CUSTOMER_ID + '/attribution-transfer-preview',
    { code: 'VERSION_CONFLICT', status: 409 },
  );
  await page.getByTestId('customer-transfer-open').click();
  const transferDialog = page.locator('.el-dialog:visible').last();
  await transferDialog.getByPlaceholder('说明本次操作原因').fill('Conflict exercise');
  await transferDialog.getByRole('button', { name: '生成操作预览' }).click();
  await expect(page.getByText('客户归属版本已变化，已刷新最新状态')).toBeVisible();
  expect(backend.callsFor(
    '/api/v1/admin/customers/' + CUSTOMER_ID + '/attribution-transfers',
    'POST',
  )).toHaveLength(0);

  await openNavigation(page, '代理管理', /\/agents$/);
  await page.getByTestId('agent-create-open').click();
  await page.getByLabel('代理名称').fill('Invalid development agent');
  await page.getByLabel('登录账号').fill('invalid.agent');
  await page.getByLabel('联系人').fill('Development contact');
  backend.enqueue('POST', '/api/v1/admin/agents', { code: 'VALIDATION_FAILED', status: 422 });
  const createButton = page.getByRole('button', { name: '创建并签发凭据' });
  await createButton.evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText('代理资料未通过业务校验')).toBeVisible();
  expect(backend.callsFor('/api/v1/admin/agents', 'POST')).toHaveLength(1);

  const createCallsBeforeUnknown = backend.callsFor('/api/v1/admin/agents', 'POST').length;
  backend.enqueue('POST', '/api/v1/admin/agents', { kind: 'ABORT_COMMIT' });
  await createButton.click();
  await expect(page.getByText('创建结果尚未确认，请保持当前表单并使用原请求重试')).toBeVisible();
  await expect(page.getByLabel('代理名称')).toBeDisabled();
  await expect(page.getByLabel('登录账号')).toBeDisabled();
  await expect(page.getByLabel('联系人')).toBeDisabled();
  await expect(page.getByLabel('联系电话（可选）')).toBeDisabled();
  await page.getByRole('button', { name: '使用原请求重试' }).click();
  await expect(page.getByText('该创建请求已被幂等重放，秘密不会再次披露；请从代理详情重新签发。')).toBeVisible();
  const unknownCalls = backend.callsFor('/api/v1/admin/agents', 'POST').slice(createCallsBeforeUnknown);
  expect(unknownCalls).toHaveLength(2);
  expect(unknownCalls[1]?.body).toEqual(unknownCalls[0]?.body);
  expect(unknownCalls[1]?.headers['idempotency-key']).toBe(unknownCalls[0]?.headers['idempotency-key']);
  await expect(page.getByText(TEMPORARY_PASSWORD, { exact: true })).toHaveCount(0);
  await expect(page.getByText(INITIAL_INVITE_CODE, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '我已完成交接并清除' }).click();

  await openNavigation(page, '账户安全', /\/settings\/account\/security$/);
  const minimum = page.getByTestId('business-rules-minimum');
  await minimum.fill('130.00');
  await page.getByTestId('business-rules-open').click();
  const businessDialog = page.locator('.el-dialog:visible').last();
  await businessDialog.getByPlaceholder('说明本次操作原因').fill('Lost response exercise');
  await businessDialog.getByRole('button', { name: '生成操作预览' }).click();
  await expect(businessDialog.getByTestId('b13-command-preview')).toBeVisible();
  backend.enqueue('PATCH', '/api/v1/admin/settings/business-rules', { kind: 'ABORT' });
  await businessDialog.getByRole('button', { name: '确认发布' }).click();
  await expect(businessDialog.getByText('服务响应中断，请使用原请求标识重试确认，或放弃并刷新服务端状态。')).toBeVisible();
  await expect(minimum).toBeDisabled();
  const firstConfirm = backend.callsFor('/api/v1/admin/settings/business-rules', 'PATCH').at(-1);
  await businessDialog.getByRole('button', { name: '使用原请求重试确认' }).click();
  await expect(businessDialog).toBeHidden();
  const confirms = backend.callsFor('/api/v1/admin/settings/business-rules', 'PATCH');
  expect(confirms).toHaveLength(2);
  expect(confirms[1]?.body).toEqual(firstConfirm?.body);
  expect(confirms[1]?.headers['idempotency-key']).toBe(firstConfirm?.headers['idempotency-key']);
  await expect(minimum).toHaveValue('130.00');

  await openNavigation(page, '提现审核', /\/withdrawals$/);
  await page.getByRole('row').filter({ hasText: 'WD0001' }).getByRole('button', { name: '处理' }).click();
  await page.getByTestId('withdrawal-approve-open').click();
  await previewAndConfirm(page, '确认批准');

  const payoutPath = '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/payout-account-reveal';
  backend.enqueue('POST', payoutPath, { kind: 'DELAY', ms: 800 });
  await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
  await page.getByLabel('当前 TOTP 动态验证码').fill('123456');
  await page.getByRole('button', { name: '验证并单次查看' }).click();
  await expect.poll(() => backend.callsFor(payoutPath, 'POST').length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
  await expect(page.getByTestId('payout-account-number')).toHaveCount(0);
  await expect(page.getByLabel('当前 TOTP 动态验证码')).toBeVisible();
  await page.getByRole('button', { name: '关闭并清除' }).click();

  backend.payoutExpiresAt = '2000-01-01T00:00:00.000Z';
  await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
  await page.getByLabel('当前 TOTP 动态验证码').fill('123456');
  await page.getByRole('button', { name: '验证并单次查看' }).click();
  await expect(page.getByText('单次授权已失效，请重新验证')).toBeVisible();
  await expect(page.getByTestId('payout-account-number')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭并清除' }).click();
  backend.payoutExpiresAt = LATER;

  await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
  await page.getByLabel('当前 TOTP 动态验证码').fill('123456');
  await page.getByRole('button', { name: '验证并单次查看' }).click();
  await expect(page.getByTestId('payout-account-number')).toHaveText(RAW_PAYOUT_ACCOUNT);
  await page.getByRole('button', { name: '复制账号并清除' }).click();
  await expect(page.getByText(RAW_PAYOUT_ACCOUNT, { exact: true })).toHaveCount(0);
  await expect(page.getByText('复制失败，账号已从页面清除')).toBeVisible();

  const proofPath = '/api/v1/admin/withdrawals/' + WITHDRAWAL_ID + '/proofs';
  backend.enqueue('POST', proofPath, { kind: 'ABORT_COMMIT' });
  await page.locator('input[type="file"][aria-label="选择付款凭证"]').setInputFiles({
    buffer: PNG_BYTES,
    mimeType: 'image/png',
    name: 'payment-proof.png',
  });
  await expect(page.getByTestId('withdrawal-proof-uncertain')).toBeVisible();
  const firstProofAttach = backend.callsFor(proofPath, 'POST').at(-1);
  await page.getByTestId('withdrawal-proof-retry').click();
  await expect(page.getByText(PROOF_ID, { exact: true })).toBeVisible();
  const proofAttachCalls = backend.callsFor(proofPath, 'POST');
  expect(proofAttachCalls).toHaveLength(2);
  expect(proofAttachCalls[1]?.body).toEqual(firstProofAttach?.body);
  expect(proofAttachCalls[1]?.headers['idempotency-key']).toBe(firstProofAttach?.headers['idempotency-key']);
  expect(backend.callsFor('/api/v1/files/upload-intents', 'POST')).toHaveLength(1);
  expect(backend.callsFor('/api/v1/files/' + PROOF_ID + '/complete', 'POST')).toHaveLength(1);

  expect(backend.unhandled).toEqual([]);
});
