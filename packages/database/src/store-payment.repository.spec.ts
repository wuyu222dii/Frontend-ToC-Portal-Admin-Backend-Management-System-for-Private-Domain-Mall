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
    id: orderId,
    inventory_reservation: { status: 'ACTIVE' },
    order_status: 'PENDING_PAYMENT',
    paid_amount: new Prisma.Decimal('0.00'),
    pay_expires_at: new Date(NOW.getTime() + 30 * 60_000),
    payable_amount: new Prisma.Decimal('39.80'),
    payment_resolution: 'NORMAL',
    payment_status: 'UNPAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
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
  intents?: ReturnType<typeof intentRecord>[];
  order?: ReturnType<typeof orderRecord>;
} = {}) {
  let createdData: Record<string, unknown> | null = null;
  const transaction = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: orderId }])
      .mockResolvedValueOnce([{ transaction_time: NOW }]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account: { findUnique: vi.fn().mockResolvedValue(activeAccount()) },
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
