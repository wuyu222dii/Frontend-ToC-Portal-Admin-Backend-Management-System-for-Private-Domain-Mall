import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StorePaymentRepository,
  type StorePaymentIntentStatus,
} from './store-payment.repository';

const NOW = new Date('2026-08-29T08:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 5_000);
const customerId = generateUlid(NOW.getTime() - 4_000);
const orderId = generateUlid(NOW.getTime() - 3_000);
const paymentIntentId = generateUlid(NOW.getTime() - 2_000);

function activeAccount() {
  return {
    customer_profile: { account_id: accountId, anonymized_at: null, id: customerId },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'payment-open-id',
  };
}

function orderRecord(overrides: Record<string, unknown> = {}) {
  return {
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    customer_id: customerId,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: new Prisma.Decimal('39.80'),
    id: orderId,
    inventory_reservation: {
      expires_at: new Date(NOW.getTime() + 30 * 60_000),
      status: 'ACTIVE',
    },
    order_status: 'PENDING_PAYMENT',
    paid_amount: new Prisma.Decimal('0.00'),
    pay_expires_at: new Date(NOW.getTime() + 30 * 60_000),
    payable_amount: new Prisma.Decimal('39.80'),
    payment_resolution: 'NORMAL',
    payment_status: 'UNPAID',
    refunded_amount: new Prisma.Decimal('0.00'),
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    shipping_amount: new Prisma.Decimal('0.00'),
    version: 4,
    ...overrides,
  };
}

function intentRecord(
  status: StorePaymentIntentStatus = 'CREATING',
  overrides: Record<string, unknown> = {},
) {
  return {
    amount: new Prisma.Decimal('39.80'),
    close_attempt_count: 0,
    close_requested_at: null,
    closed_at: null,
    create_requested_at: NOW,
    created_at: NOW,
    expires_at: new Date(NOW.getTime() + 30 * 60_000),
    id: paymentIntentId,
    intent_no: `PI${paymentIntentId}`,
    last_error_code: null,
    last_reconciled_at: null,
    next_reconcile_at: new Date(NOW.getTime() + 30_000),
    opened_at: null,
    order_id: orderId,
    provider: 'MOCK',
    provider_intent_id: null,
    provider_state: 'CREATE_REQUESTED',
    reconciliation_attempt_count: 0,
    status,
    succeeded_at: null,
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function prepareHarness(options: {
  attribution?: Record<string, unknown> | null;
  intents?: ReturnType<typeof intentRecord>[];
  items?: Array<Record<string, unknown>>;
  order?: ReturnType<typeof orderRecord>;
  ruleVersions?: Array<Record<string, unknown>>;
} = {}) {
  let createdData: Record<string, unknown> | null = null;
  const defaultItem = {
    line_paid_amount: new Prisma.Decimal('39.80'),
    sku: { product: { category_id: paymentIntentId } },
    sku_id: paymentIntentId,
  };
  const transaction = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: orderId }])
      .mockResolvedValueOnce([{ transaction_time: NOW }]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account: { findUnique: vi.fn().mockResolvedValue(activeAccount()) },
    commissionRuleVersion: { findMany: vi.fn().mockResolvedValue(options.ruleVersions ?? []) },
    orderAttributionCandidate: {
      findUnique: vi.fn().mockResolvedValue(options.attribution ?? null),
    },
    orderItem: { findMany: vi.fn().mockResolvedValue(options.items ?? [defaultItem]) },
    paymentIntent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return intentRecord('CREATING', {
          ...data,
          id: data.id,
          intent_no: data.intent_no,
        });
      }),
      findMany: vi.fn().mockResolvedValue(options.intents ?? []),
    },
    salesOrder: { findUnique: vi.fn().mockResolvedValue(options.order ?? orderRecord()) },
  };
  return {
    createdData: () => createdData,
    transaction: transaction as unknown as DatabaseTransaction,
    unsafe: transaction,
  };
}

function finalizeHarness(
  before: ReturnType<typeof intentRecord>,
  after: ReturnType<typeof intentRecord>,
  order = orderRecord(),
) {
  const transaction = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: orderId }])
      .mockResolvedValueOnce([{ id: paymentIntentId }])
      .mockResolvedValueOnce([{ transaction_time: NOW }]),
    paymentIntent: {
      findUnique: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    salesOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    transaction: transaction as unknown as DatabaseTransaction,
    unsafe: transaction,
  };
}

describe('StorePaymentRepository', () => {
  const repository = new StorePaymentRepository();

  it('locks the customer and order before persisting a recoverable CREATING intent', async () => {
    const harness = prepareHarness();
    const result = await repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    });

    expect(result).toMatchObject({
      created: true,
      providerOperation: 'CREATE',
      intent: {
        amount: '39.80',
        orderId,
        provider: 'MOCK',
        status: 'CREATING',
        version: 1,
      },
    });
    expect(harness.unsafe.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(harness.createdData()).toMatchObject({
      next_reconcile_at: new Date(NOW.getTime() + 30_000),
      provider_state: 'CREATE_REQUESTED',
      status: 'CREATING',
    });
  });

  it.each([
    { items: [], label: 'an empty order' },
    {
      items: [{ line_paid_amount: new Prisma.Decimal('39.79') }],
      label: 'an item total mismatch',
    },
  ])('refuses Provider create for $label', async ({ items }) => {
    const harness = prepareHarness({ items });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'PAYMENT_NOT_ALLOWED' });
    expect(harness.unsafe.paymentIntent.create).not.toHaveBeenCalled();
    expect(harness.unsafe.commissionRuleVersion.findMany).not.toHaveBeenCalled();
  });

  it('refuses Provider work when an active attributed agent has no resolvable published commission rules', async () => {
    const harness = prepareHarness({
      attribution: {
        candidate_agent: {
          account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
          deleted_at: null,
          status: 'ACTIVE',
        },
        candidate_agent_id: generateUlid(NOW.getTime() - 6_000),
        submit_channel: 'AGENT',
      },
      items: [{
        line_paid_amount: new Prisma.Decimal('39.80'),
        sku: { product: { category_id: generateUlid(NOW.getTime() - 7_000) } },
        sku_id: paymentIntentId,
      }],
      ruleVersions: [],
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'PAYMENT_CONFIGURATION_UNAVAILABLE' });
    expect(harness.unsafe.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('does not let a disabled attributed agent block direct payment preparation', async () => {
    const harness = prepareHarness({
      attribution: {
        candidate_agent: {
          account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
          deleted_at: null,
          status: 'DISABLED',
        },
        candidate_agent_id: generateUlid(NOW.getTime() - 6_000),
        submit_channel: 'AGENT',
      },
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).resolves.toMatchObject({ created: true, providerOperation: 'CREATE' });
    expect(harness.unsafe.commissionRuleVersion.findMany).not.toHaveBeenCalled();
  });

  it('queries every durable active intent before deciding whether Provider create is needed', async () => {
    const creatingHarness = prepareHarness({ intents: [intentRecord()] });
    const creating = await repository.prepareOwnedPaymentIntentInTransaction(creatingHarness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    });
    expect(creating).toMatchObject({ created: false, providerOperation: 'QUERY' });
    expect(creatingHarness.unsafe.paymentIntent.create).not.toHaveBeenCalled();

    const openHarness = prepareHarness({
      intents: [intentRecord('OPEN', { provider_intent_id: 'mock-intent-1' })],
      order: orderRecord({ payment_status: 'PROCESSING' }),
    });
    const open = await repository.prepareOwnedPaymentIntentInTransaction(openHarness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    });
    expect(open).toMatchObject({ created: false, providerOperation: 'QUERY' });
  });

  it('queries an existing active intent even when commission configuration is now unavailable', async () => {
    const harness = prepareHarness({
      attribution: {
        candidate_agent: {
          account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
          deleted_at: null,
          status: 'ACTIVE',
        },
        candidate_agent_id: generateUlid(NOW.getTime() - 6_000),
        submit_channel: 'AGENT',
      },
      intents: [intentRecord('OPEN', { provider_intent_id: 'mock-intent-1' })],
      order: orderRecord({ payment_status: 'PROCESSING' }),
      ruleVersions: [],
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).resolves.toMatchObject({ created: false, providerOperation: 'QUERY' });
    expect(harness.unsafe.commissionRuleVersion.findMany).not.toHaveBeenCalled();
    expect(harness.unsafe.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('queries an existing active intent before evaluating drifted order item totals', async () => {
    const harness = prepareHarness({
      intents: [intentRecord('OPEN', { provider_intent_id: 'mock-intent-1' })],
      items: [],
      order: orderRecord({ payment_status: 'PROCESSING' }),
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(harness.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).resolves.toMatchObject({ created: false, providerOperation: 'QUERY' });
    expect(harness.unsafe.orderItem.findMany).not.toHaveBeenCalled();
    expect(harness.unsafe.paymentIntent.create).not.toHaveBeenCalled();
  });

  it.each([
    { expectedCode: undefined, items: [{ line_paid_amount: new Prisma.Decimal('39.80') }] },
    { expectedCode: 'PAYMENT_NOT_ALLOWED', items: [] },
  ])('revalidates amount closure after Provider query returns NOT_FOUND', async ({ expectedCode, items }) => {
    const transaction = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: orderId }])
        .mockResolvedValueOnce([{ id: paymentIntentId }])
        .mockResolvedValueOnce([{ transaction_time: NOW }]),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      account: { findUnique: vi.fn().mockResolvedValue(activeAccount()) },
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      orderItem: { findMany: vi.fn().mockResolvedValue(items) },
      paymentIntent: { findUnique: vi.fn().mockResolvedValue(intentRecord()) },
      salesOrder: { findUnique: vi.fn().mockResolvedValue(orderRecord()) },
    };
    const operation = repository.revalidateProviderCreateInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        accountId,
        customerId,
        expectedIntentVersion: 1,
        orderId,
        paymentIntentId,
        provider: 'MOCK',
      },
    );
    if (expectedCode === undefined) {
      await expect(operation).resolves.toMatchObject({ paymentIntentId, status: 'CREATING' });
      expect(transaction.orderAttributionCandidate.findUnique).toHaveBeenCalledTimes(1);
    } else {
      await expect(operation).rejects.toMatchObject({ code: expectedCode });
      expect(transaction.orderAttributionCandidate.findUnique).not.toHaveBeenCalled();
    }
  });

  it('requires the current order version when reusing an OPEN intent', async () => {
    const stale = prepareHarness({
      intents: [intentRecord('OPEN', { provider_intent_id: 'mock-intent-1' })],
      order: orderRecord({ payment_status: 'PROCESSING', version: 5 }),
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(stale.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
  });

  it('rejects stale versions and refuses to create after the database payment deadline', async () => {
    const stale = prepareHarness();
    await expect(repository.prepareOwnedPaymentIntentInTransaction(stale.transaction, {
      accountId,
      customerId,
      expectedVersion: 3,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    const expired = prepareHarness({
      order: orderRecord({ pay_expires_at: new Date(NOW.getTime() - 1) }),
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(expired.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'ORDER_PAYMENT_EXPIRED' });

    const expiredWithActiveIntent = prepareHarness({
      intents: [intentRecord('OPEN', { provider_intent_id: 'mock-intent-1' })],
      order: orderRecord({ pay_expires_at: new Date(NOW.getTime() - 1) }),
    });
    await expect(repository.prepareOwnedPaymentIntentInTransaction(expiredWithActiveIntent.transaction, {
      accountId,
      customerId,
      expectedVersion: 4,
      orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    })).rejects.toMatchObject({ code: 'ORDER_PAYMENT_EXPIRED' });
    expect(expiredWithActiveIntent.unsafe.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('opens a prepared intent without storing Provider capability material', async () => {
    const nextReconcileAt = new Date(NOW.getTime() + 60_000);
    const after = intentRecord('OPEN', {
      next_reconcile_at: nextReconcileAt,
      opened_at: NOW,
      provider_intent_id: 'mock-intent-1',
      provider_state: 'OPEN',
      version: 2,
    });
    const harness = finalizeHarness(intentRecord(), after);
    const result = await repository.finalizeProviderOutcomeInTransaction(harness.transaction, {
      expectedVersion: 1,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        kind: 'OPEN',
        nextReconcileAt,
        providerIntentId: 'mock-intent-1',
        providerState: 'OPEN',
      },
    });
    expect(result).toMatchObject({
      changed: true,
      intent: { status: 'OPEN', providerIntentId: 'mock-intent-1', version: 2 },
    });
    expect(harness.unsafe.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ provider_payload: expect.anything() }),
      where: { id: paymentIntentId, order_id: orderId, version: 1 },
    }));
    expect(harness.unsafe.salesOrder.updateMany).toHaveBeenCalledWith({
      data: {
        payment_status: 'PROCESSING',
        updated_at: NOW,
        version: { increment: 1 },
      },
      where: { id: orderId, payment_status: 'UNPAID', version: 4 },
    });
  });

  it('keeps UNKNOWN fail-closed and schedules reconciliation', async () => {
    const nextReconcileAt = new Date(NOW.getTime() + 45_000);
    const after = intentRecord('CREATING', {
      last_error_code: 'PROVIDER_TIMEOUT',
      last_reconciled_at: NOW,
      next_reconcile_at: nextReconcileAt,
      reconciliation_attempt_count: 1,
      version: 2,
    });
    const harness = finalizeHarness(intentRecord(), after);
    const result = await repository.finalizeProviderOutcomeInTransaction(harness.transaction, {
      expectedVersion: 1,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        errorCode: 'PROVIDER_TIMEOUT',
        kind: 'UNKNOWN',
        nextReconcileAt,
        providerState: null,
      },
    });
    expect(result).toMatchObject({
      changed: true,
      intent: { lastErrorCode: 'PROVIDER_TIMEOUT', status: 'CREATING', version: 2 },
    });
    expect(harness.unsafe.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reconciliation_attempt_count: { increment: 1 } }),
    }));
    expect(harness.unsafe.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('returns a PROCESSING order to UNPAID when Provider reaches a terminal failure', async () => {
    const after = intentRecord('FAILED', {
      closed_at: NOW,
      last_error_code: 'PAYMENT_FAILED',
      provider_intent_id: 'mock-intent-1',
      provider_state: 'FAILED',
      version: 3,
    });
    const harness = finalizeHarness(
      intentRecord('OPEN', { provider_intent_id: 'mock-intent-1', version: 2 }),
      after,
      orderRecord({ payment_status: 'PROCESSING', version: 5 }),
    );
    await expect(repository.finalizeProviderOutcomeInTransaction(harness.transaction, {
      expectedVersion: 2,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        errorCode: 'PAYMENT_FAILED',
        kind: 'TERMINAL',
        providerIntentId: 'mock-intent-1',
        providerState: 'FAILED',
        status: 'FAILED',
      },
    })).resolves.toMatchObject({ changed: true, intent: { status: 'FAILED', version: 3 } });
    expect(harness.unsafe.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payment_status: 'UNPAID', version: { increment: 1 } }),
      where: { id: orderId, payment_status: 'PROCESSING', version: 5 },
    }));
  });

  it('does not let a stale Provider result overwrite a different terminal state', async () => {
    const harness = finalizeHarness(intentRecord('FAILED', { version: 2 }), intentRecord('FAILED', { version: 2 }));
    await expect(repository.finalizeProviderOutcomeInTransaction(harness.transaction, {
      expectedVersion: 1,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        kind: 'OPEN',
        nextReconcileAt: new Date(NOW.getTime() + 60_000),
        providerIntentId: 'mock-intent-1',
        providerState: 'OPEN',
      },
    })).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
    expect(harness.unsafe.paymentIntent.updateMany).not.toHaveBeenCalled();
  });

  it('replays an already applied Provider result before version enforcement', async () => {
    const applied = intentRecord('OPEN', {
      opened_at: NOW,
      provider_intent_id: 'mock-intent-1',
      provider_state: 'OPEN',
      version: 2,
    });
    const harness = finalizeHarness(applied, applied, orderRecord({ payment_status: 'PROCESSING', version: 5 }));
    const result = await repository.finalizeProviderOutcomeInTransaction(harness.transaction, {
      expectedVersion: 1,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        kind: 'OPEN',
        nextReconcileAt: new Date(NOW.getTime() + 60_000),
        providerIntentId: 'mock-intent-1',
        providerState: 'OPEN',
      },
    });
    expect(result).toMatchObject({ changed: false, intent: { status: 'OPEN', version: 2 } });
    expect(harness.unsafe.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(harness.unsafe.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('returns an owned current projection and hides cross-customer payment intents', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
      paymentIntent: { findFirst: vi.fn().mockResolvedValue(intentRecord('OPEN')) },
    } as unknown as DatabaseTransaction;
    await expect(repository.getOwnedPaymentIntentInTransaction(transaction, {
      customerId,
      paymentIntentId,
    })).resolves.toMatchObject({ paymentIntentId, orderId });

    const missingTransaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
      paymentIntent: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as DatabaseTransaction;
    await expect(repository.getOwnedPaymentIntentInTransaction(missingTransaction, {
      customerId,
      paymentIntentId,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
