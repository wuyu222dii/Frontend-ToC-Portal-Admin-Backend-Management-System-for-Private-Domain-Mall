import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminCustomerAttributionTransferImpact,
  AdminCustomerAttributionTransferResult,
  AdminCustomerDetail,
  AdminCustomerSnapshot,
  CacheableAdminCustomerResponse,
  DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCustomerRequestContext } from './admin-customers.request';
import { AdminCustomersService } from './admin-customers.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const OLD_AGENT_ID = '01J00000000000000000000002';
const TARGET_AGENT_ID = '01J00000000000000000000003';
const OLD_BINDING_ID = '01J00000000000000000000004';
const NEW_BINDING_ID = '01J00000000000000000000005';
const ORDER_ID = '01J00000000000000000000006';
const SESSION_ID = '01J00000000000000000000007';
const FACTOR_ID = '01J00000000000000000000008';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const CONFIRMATION_HASH = 'a'.repeat(64);
const PREVIEW_TOKEN = `pvw_${'b'.repeat(43)}`;
const REGISTERED_AT = new Date('2026-08-01T00:00:00.000Z');
const PURCHASED_AT = new Date('2026-08-20T02:00:00.000Z');
const BOUND_AT = new Date('2026-08-02T03:00:00.000Z');
const TRANSFERRED_AT = new Date('2026-09-03T04:00:00.000Z');

function config(): PlatformRuntimeConfig {
  return {
    agent: {} as PlatformRuntimeConfig['agent'],
    authentication: {} as PlatformRuntimeConfig['authentication'],
    banner: { targetOrigins: [] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { mockSigningKey: Buffer.alloc(32, 4), provider: 'MOCK', providerTimeoutMs: 5_000 },
    port: 3000,
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    store: {} as PlatformRuntimeConfig['store'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(): AdminCustomerRequestContext {
  return {
    accessSession: {
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-09-03T06:00:00.000Z'),
      factorEncryptionKeyId: 'factor-key',
      factorId: FACTOR_ID,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-09-03T03:00:00.000Z'),
      sessionFamily: '01J00000000000000000000009',
      sessionId: SESSION_ID,
    },
    principal: {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: SESSION_ID,
    },
    requestId: REQUEST_ID,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function customer(overrides: Partial<AdminCustomerSnapshot> = {}): AdminCustomerSnapshot {
  return {
    accountStatus: 'ACTIVE',
    city: 'Hangzhou',
    consumptionAmount: '128.50',
    consumptionCount: 2,
    currentBinding: {
      agentId: OLD_AGENT_ID,
      agentName: 'Old Agent',
      bindingId: OLD_BINDING_ID,
      customerId: CUSTOMER_ID,
      customerVersion: 4,
      startedAt: BOUND_AT,
    },
    customerAlias: 'customer_0123456789abcdef0123456789',
    customerId: CUSTOMER_ID,
    deletionRequestStatus: null,
    lastOrderId: ORDER_ID,
    lastProductName: 'Daily wash',
    lastPurchaseAt: PURCHASED_AT,
    managementNotePresent: false,
    nicknameMasked: 'A**',
    phoneMasked: '*** **** 1234',
    registeredAt: REGISTERED_AT,
    version: 4,
    ...overrides,
  };
}

function detail(): AdminCustomerDetail {
  return {
    bindingHistory: [{
      agentId: OLD_AGENT_ID,
      agentName: 'Old Agent',
      bindingId: OLD_BINDING_ID,
      changeReason: null,
      endedAt: null,
      endReason: null,
      recordedAt: BOUND_AT,
      startedAt: BOUND_AT,
    }],
    customer: customer(),
    orders: [{
      displayStatus: 'Completed',
      orderId: ORDER_ID,
      orderNo: 'ORDER-001',
      paidAt: PURCHASED_AT,
      payableAmount: '128.50',
    }],
  };
}

function impact(overrides: Partial<AdminCustomerAttributionTransferImpact> = {}): AdminCustomerAttributionTransferImpact {
  return {
    activeCandidateCount: 3,
    currentBinding: customer().currentBinding,
    customer: customer(),
    paidOrderCount: 2,
    pendingOrderCount: 1,
    targetAgent: { agentId: TARGET_AGENT_ID, agentName: 'Target Agent', status: 'ACTIVE' },
    ...overrides,
  };
}

function transferResult(
  overrides: Partial<AdminCustomerAttributionTransferResult> = {},
): AdminCustomerAttributionTransferResult {
  const nextBinding = {
    agentId: TARGET_AGENT_ID,
    agentName: 'Target Agent',
    bindingId: NEW_BINDING_ID,
    customerId: CUSTOMER_ID,
    customerVersion: 5,
    startedAt: TRANSFERRED_AT,
  };
  return {
    afterBinding: nextBinding,
    beforeBinding: customer().currentBinding,
    customer: customer({ currentBinding: nextBinding, version: 5 }),
    invalidatedCandidateCount: 3,
    occurredAt: TRANSFERRED_AT,
    ...overrides,
  };
}

function cachedResponse(overrides: Partial<CacheableAdminCustomerResponse['data']> = {}): CacheableAdminCustomerResponse {
  return {
    code: 'OK',
    data: {
      account_status: 'ACTIVE',
      binding: {
        agent_id: TARGET_AGENT_ID,
        agent_name: 'Target Agent',
        binding_id: NEW_BINDING_ID,
        customer_id: CUSTOMER_ID,
        customer_version: 5,
        started_at: TRANSFERRED_AT.toISOString(),
      },
      city: 'Hangzhou',
      consumption_amount: '128.50',
      consumption_count: 2,
      customer_alias: 'customer_0123456789abcdef0123456789',
      customer_id: CUSTOMER_ID,
      deletion_request_status: null,
      last_order_id: ORDER_ID,
      last_product_name: 'Daily wash',
      last_purchase_at: PURCHASED_AT.toISOString(),
      management_note_present: false,
      nickname_masked: 'A**',
      phone_masked: '*** **** 1234',
      registered_at: REGISTERED_AT.toISOString(),
      version: 5,
      ...overrides,
    },
    message: 'success',
    request_id: REQUEST_ID,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  customers: {
    getAttributionTransferImpactInTransaction: ReturnType<typeof vi.fn>;
    getCustomerDetail: ReturnType<typeof vi.fn>;
    listCustomers: ReturnType<typeof vi.fn>;
    transferAttributionInTransaction: ReturnType<typeof vi.fn>;
  };
  idempotency: {
    adminCustomerReplay: ReturnType<typeof vi.fn>;
    assertKeyNotUsedForRequest: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  previews: {
    consumeInTransaction: ReturnType<typeof vi.fn>;
    issueInTransaction: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  const transaction = {};
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
  };
  const database = { pool: {}, prisma } as unknown as DatabaseRuntime;
  const service = new AdminCustomersService(config(), database);
  const mocks: ServiceInternals = {
    audit: { append: vi.fn().mockResolvedValue({}) },
    customers: {
      getAttributionTransferImpactInTransaction: vi.fn().mockResolvedValue(impact()),
      getCustomerDetail: vi.fn().mockResolvedValue(detail()),
      listCustomers: vi.fn().mockResolvedValue({ items: [customer()], total: 1 }),
      transferAttributionInTransaction: vi.fn().mockResolvedValue(transferResult()),
    },
    idempotency: {
      adminCustomerReplay: vi.fn().mockReturnValue(cachedResponse()),
      assertKeyNotUsedForRequest: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
      complete: vi.fn().mockResolvedValue({}),
    },
    outbox: { append: vi.fn().mockResolvedValue({}) },
    previews: {
      consumeInTransaction: vi.fn().mockResolvedValue(undefined),
      issueInTransaction: vi.fn().mockResolvedValue({
        confirmationHash: CONFIRMATION_HASH,
        expiresAt: new Date('2026-09-03T04:01:00.000Z'),
      }),
    },
  };
  Object.assign(service as unknown as ServiceInternals, mocks);
  return { mocks, service, transaction };
}

describe('AdminCustomersService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when runtime dependencies are unavailable', async () => {
    const service = new AdminCustomersService();
    await expect(service.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('maps list and detail to closed Admin contract views', async () => {
    const { mocks, service } = harness();
    const listInput = { page: 2, pageSize: 50 };
    await expect(service.list(listInput)).resolves.toEqual({
      items: [cachedResponse({
        binding: {
          agent_id: OLD_AGENT_ID,
          agent_name: 'Old Agent',
          binding_id: OLD_BINDING_ID,
          customer_id: CUSTOMER_ID,
          customer_version: 4,
          started_at: BOUND_AT.toISOString(),
        },
        version: 4,
      }).data],
      pagination: { page: 2, page_size: 50, total: 1 },
    });
    expect(mocks.customers.listCustomers).toHaveBeenCalledWith(listInput);

    await expect(service.detail(CUSTOMER_ID)).resolves.toEqual({
      binding_history: [{
        agent_id: OLD_AGENT_ID,
        agent_name: 'Old Agent',
        binding_id: OLD_BINDING_ID,
        change_reason: null,
        ended_at: null,
        end_reason: null,
        recorded_at: BOUND_AT.toISOString(),
        started_at: BOUND_AT.toISOString(),
      }],
      customer: cachedResponse({
        binding: {
          agent_id: OLD_AGENT_ID,
          agent_name: 'Old Agent',
          binding_id: OLD_BINDING_ID,
          customer_id: CUSTOMER_ID,
          customer_version: 4,
          started_at: BOUND_AT.toISOString(),
        },
        version: 4,
      }).data,
      orders: [{
        display_status: 'Completed',
        order_id: ORDER_ID,
        order_no: 'ORDER-001',
        paid_at: PURCHASED_AT.toISOString(),
        payable_amount: '128.50',
      }],
    });
  });

  it('issues a target-bound HASH_ONLY preview without retaining its capability token', async () => {
    const { mocks, service } = harness();
    const response = await service.previewTransfer(requestContext(), CUSTOMER_ID, {
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    }, IDEMPOTENCY_KEY);

    expect(response).toEqual({
      confirmation_hash: CONFIRMATION_HASH,
      expires_at: '2026-09-03T04:01:00.000Z',
      impact: {
        affected_count: 4,
        metrics: [
          { after: 'Target Agent', before: 'Old Agent', key: 'current_attribution', label: '当前归属' },
          { after: '0', before: '3', key: 'eligible_candidates', label: '可归因候选' },
          { after: '1', before: '1', key: 'pending_payment_orders', label: '既有待付款订单' },
          { after: '2', before: '2', key: 'historical_paid_orders', label: '历史已支付订单' },
        ],
        warnings: [
          '与订单提交按绑定版本串行；先提交的既有订单保留候选，转移后新订单使用新归属。',
          '支付归属快照、历史订单和历史佣金保持不变。',
        ],
      },
      preview_token: expect.stringMatching(/^pvw_[A-Za-z0-9_-]{43}$/),
      resource_etag: '"4"',
    });
    expect(mocks.previews.issueInTransaction).toHaveBeenCalledWith(expect.anything(), {
      action: 'CUSTOMER.ATTRIBUTION_TRANSFER',
      actorId: ACCOUNT_ID,
      previewToken: response.preview_token,
      request: {
        impact: { active_candidate_count: 3, paid_order_count: 2, pending_order_count: 1 },
        reason: 'Regional ownership correction',
        target_agent_id: TARGET_AGENT_ID,
      },
      resourceVersion: 4,
      sessionId: SESSION_ID,
      targetId: CUSTOMER_ID,
      targetType: 'CUSTOMER',
    });
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: CUSTOMER_ID,
      responseForHash: expect.not.objectContaining({ preview_token: expect.anything() }),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    const order = [
      mocks.idempotency.claim,
      mocks.customers.getAttributionTransferImpactInTransaction,
      mocks.previews.issueInTransaction,
      mocks.idempotency.complete,
    ].map((mock) => mock.mock.invocationCallOrder[0] as number);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('rejects a replayed preview key before reading mutable facts', async () => {
    const { mocks, service } = harness();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    await expect(service.previewTransfer(requestContext(), CUSTOMER_ID, {
      reason: 'Move to direct operation', targetAgentId: null,
    }, IDEMPOTENCY_KEY)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(mocks.customers.getAttributionTransferImpactInTransaction).not.toHaveBeenCalled();
    expect(mocks.previews.issueInTransaction).not.toHaveBeenCalled();
  });

  it('confirms in order and atomically writes transfer, audit, outbox and replay envelope', async () => {
    const { mocks, service } = harness();
    const input = {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    };
    const response = await service.transfer(
      requestContext(), CUSTOMER_ID, input, 4, IDEMPOTENCY_KEY,
    );

    expect(response.envelope).toEqual(cachedResponse());
    expect(mocks.idempotency.assertKeyNotUsedForRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      method: 'POST',
      route: '/admin/customers/{customer_id}/attribution-transfer-preview',
    });
    expect(mocks.previews.consumeInTransaction).toHaveBeenCalledWith(expect.anything(), {
      action: 'CUSTOMER.ATTRIBUTION_TRANSFER',
      actorId: ACCOUNT_ID,
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      request: {
        impact: { active_candidate_count: 3, paid_order_count: 2, pending_order_count: 1 },
        reason: input.reason,
        target_agent_id: TARGET_AGENT_ID,
      },
      resourceVersion: 4,
      sessionId: SESSION_ID,
      targetId: CUSTOMER_ID,
      targetType: 'CUSTOMER',
    });
    expect(mocks.customers.transferAttributionInTransaction).toHaveBeenCalledWith(expect.anything(), {
      actorAccountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedVersion: 4,
      reason: input.reason,
      targetAgentId: TARGET_AGENT_ID,
    });
    expect(mocks.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'TRANSFER',
      actorAccountId: ACCOUNT_ID,
      after: { version: 5 },
      before: { version: 4 },
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: '127.0.0.1',
      module: 'attribution',
      objectId: CUSTOMER_ID,
      objectType: 'customer',
      reason: expect.stringMatching(/^CUSTOMER_ATTRIBUTION_TRANSFER:[a-f0-9]{64}$/),
    }));
    expect(mocks.outbox.append).toHaveBeenCalledWith(expect.anything(), {
      aggregateId: CUSTOMER_ID,
      aggregateType: 'customer',
      eventType: 'customer.attribution_changed',
      payload: {
        event_version: 1,
        resource_id: CUSTOMER_ID,
        resource_type: 'customer',
        resource_version: 5,
      },
    });
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      policy: 'ADMIN_CUSTOMER_RESPONSE',
      responseBody: cachedResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    expect(mocks.idempotency.claim).toHaveBeenCalledWith(expect.anything(), {
      actorId: ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      request: {
        body: {
          confirmation_hash: CONFIRMATION_HASH,
          expected_version: 4,
          preview_token: PREVIEW_TOKEN,
          reason: input.reason,
          target_agent_id: TARGET_AGENT_ID,
        },
        method: 'POST',
        pathParameters: { customer_id: CUSTOMER_ID },
        route: '/admin/customers/{customer_id}/attribution-transfers',
      },
    });
    const order = [
      mocks.idempotency.claim,
      mocks.idempotency.assertKeyNotUsedForRequest,
      mocks.customers.getAttributionTransferImpactInTransaction,
      mocks.previews.consumeInTransaction,
      mocks.customers.transferAttributionInTransaction,
      mocks.audit.append,
      mocks.outbox.append,
      mocks.idempotency.complete,
    ].map((mock) => mock.mock.invocationCallOrder[0] as number);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('replays the original customer envelope without touching mutable facts', async () => {
    const { mocks, service } = harness();
    const original = cachedResponse();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    mocks.idempotency.adminCustomerReplay.mockReturnValue(original);
    const replay = await service.transfer(requestContext(), CUSTOMER_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    }, 4, IDEMPOTENCY_KEY);
    expect(replay.envelope).toBe(original);
    expect(mocks.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(mocks.idempotency.assertKeyNotUsedForRequest).not.toHaveBeenCalled();
    expect(mocks.customers.transferAttributionInTransaction).not.toHaveBeenCalled();
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
  });

  it('rejects a confirmation key reused from preview before reading mutable facts', async () => {
    const { mocks, service } = harness();
    mocks.idempotency.assertKeyNotUsedForRequest.mockRejectedValue(
      new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used in another request scope'),
    );
    await expect(service.transfer(requestContext(), CUSTOMER_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    }, 4, IDEMPOTENCY_KEY)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(mocks.customers.getAttributionTransferImpactInTransaction).not.toHaveBeenCalled();
    expect(mocks.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(mocks.customers.transferAttributionInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed for a replay envelope bound to another customer', async () => {
    const { mocks, service } = harness();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    mocks.idempotency.adminCustomerReplay.mockReturnValue(cachedResponse({ customer_id: TARGET_AGENT_ID }));
    await expect(service.transfer(requestContext(), CUSTOMER_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    }, 4, IDEMPOTENCY_KEY)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(mocks.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('does not append or cache facts after a failed transfer', async () => {
    const { mocks, service } = harness();
    mocks.customers.transferAttributionInTransaction.mockRejectedValue(
      new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Customer version changed'),
    );
    await expect(service.transfer(requestContext(), CUSTOMER_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Regional ownership correction',
      targetAgentId: TARGET_AGENT_ID,
    }, 4, IDEMPOTENCY_KEY)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
  });
});
