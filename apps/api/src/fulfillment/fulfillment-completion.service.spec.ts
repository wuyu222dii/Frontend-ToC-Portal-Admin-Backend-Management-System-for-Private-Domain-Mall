import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentCompletionService } from './fulfillment-completion.service';

const ADMIN_ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ACCOUNT_ID = '01J00000000000000000000002';
const CUSTOMER_ID = '01J00000000000000000000003';
const ORDER_ID = '01J00000000000000000000004';
const SHIPMENT_ID = '01J00000000000000000000005';
const RULE_ID = '01J00000000000000000000006';
const AGENT_ID = '01J00000000000000000000007';
const POSITION_ID = '01J00000000000000000000008';
const LEDGER_ID = '01J00000000000000000000009';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const COMPLETED_AT = new Date('2026-08-31T01:00:00.000Z');
const AFTERSALE_EXPIRES_AT = new Date('2026-09-07T01:00:00.000Z');

const config = {
  encryption: {
    idempotencyHashKeys: {
      current: { id: 'idempotency-current', key: Buffer.alloc(32, 61) },
      previous: [],
    },
    ipHashKey: Buffer.alloc(32, 62),
  },
} as unknown as PlatformRuntimeConfig;

function result() {
  return {
    after: {
      fulfillmentStatus: 'DELIVERED',
      orderStatus: 'COMPLETED',
      orderVersion: 5,
      shipmentStatus: 'DELIVERED',
      shipmentVersion: 3,
    },
    aftersaleExpiresAt: AFTERSALE_EXPIRES_AT,
    before: {
      fulfillmentStatus: 'IN_TRANSIT',
      orderStatus: 'SHIPPING',
      orderVersion: 4,
      shipmentStatus: 'IN_TRANSIT',
      shipmentVersion: 2,
    },
    businessRuleVersionId: RULE_ID,
    commissionCredits: [{
      agentId: AGENT_ID,
      amount: '8.00',
      ledgerId: LEDGER_ID,
      positionId: POSITION_ID,
      version: 2,
    }],
    completedAt: COMPLETED_AT,
    orderId: ORDER_ID,
    shipmentId: SHIPMENT_ID,
  };
}

function harness() {
  const sequence: string[] = [];
  const transaction = {};
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
  };
  const database = { pool: {}, prisma } as unknown as DatabaseRuntime;
  const service = new FulfillmentCompletionService(config, database);
  const audit = {
    append: vi.fn(async () => {
      sequence.push('audit');
    }),
  };
  const fulfillment = {
    completeOrderInTransaction: vi.fn(async () => {
      sequence.push('completeOrder');
      return result();
    }),
    getCompletedOrderForReplayInTransaction: vi.fn(async () => {
      sequence.push('getReplay');
      return result();
    }),
  };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => {
      sequence.push('assertReplay');
    }),
    claim: vi.fn<() => Promise<
      | { kind: 'execute' }
      | { kind: 'replay'; record: { resource_id: string; response_body: null; response_status: number } }
    >>(async () => {
      sequence.push('claim');
      return { kind: 'execute' as const };
    }),
    complete: vi.fn(async () => {
      sequence.push('completeIdempotency');
    }),
  };
  const outbox = {
    append: vi.fn(async (_transaction: unknown, _event: unknown) => {
      void [_transaction, _event];
      sequence.push('outbox');
    }),
  };
  Object.assign(service, { audit, fulfillment, idempotency, outbox });
  return { audit, fulfillment, idempotency, outbox, sequence, service, transaction };
}

describe('B11.3 FulfillmentCompletionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atomically completes an Admin command with redacted audit, completion events and HASH_ONLY fact', async () => {
    const current = harness();

    await expect(current.service.completeAdmin({
      actorAccountId: ADMIN_ACCOUNT_ID,
      expectedOrderVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: '127.0.0.1',
      orderId: ORDER_ID,
      reason: 'Delivery evidence verified',
      requestId: REQUEST_ID,
    })).resolves.toMatchObject({ orderId: ORDER_ID, completedAt: COMPLETED_AT });

    expect(current.sequence).toEqual([
      'claim',
      'completeOrder',
      'audit',
      'outbox',
      'outbox',
      'completeIdempotency',
    ]);
    expect(current.fulfillment.completeOrderInTransaction).toHaveBeenCalledWith(current.transaction, {
      actor: { actorAccountId: ADMIN_ACCOUNT_ID, kind: 'ADMIN' },
      completionReason: 'ADMIN_FORCED',
      expectedOrderVersion: 4,
      orderId: ORDER_ID,
    });
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'COMPLETE',
      actorAccountId: ADMIN_ACCOUNT_ID,
      actorRole: 'SUPER_ADMIN',
      after: { status: 'COMPLETED', version: 5 },
      before: { status: 'SHIPPING', version: 4 },
      module: 'fulfillment',
      objectId: ORDER_ID,
      reason: 'Delivery evidence verified',
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(current.outbox.append.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ aggregateId: ORDER_ID, eventType: 'order.completed' }),
      expect.objectContaining({ aggregateId: LEDGER_ID, eventType: 'commission.available.credited' }),
    ]);
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ actorId: ADMIN_ACCOUNT_ID, idempotencyKey: IDEMPOTENCY_KEY }),
      {
        resourceId: ORDER_ID,
        responseForHash: {
          order_completed: { completion_reason: 'ADMIN_FORCED', order_id: ORDER_ID },
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      },
    );
  });

  it('reauthorizes a CUSTOMER replay under lock before verifying HASH_ONLY and ignores stale If-Match', async () => {
    const current = harness();
    const record = { resource_id: ORDER_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockImplementationOnce(async () => {
      current.sequence.push('claim');
      return { kind: 'replay' as const, record };
    });

    await expect(current.service.confirmCustomer({
      accountId: CUSTOMER_ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedOrderVersion: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
      orderId: ORDER_ID,
      requestId: REQUEST_ID,
    })).resolves.toMatchObject({ orderId: ORDER_ID });

    expect(current.sequence).toEqual(['claim', 'getReplay', 'assertReplay']);
    expect(current.fulfillment.getCompletedOrderForReplayInTransaction)
      .toHaveBeenCalledWith(current.transaction, {
        actor: { accountId: CUSTOMER_ACCOUNT_ID, customerId: CUSTOMER_ID, kind: 'CUSTOMER' },
        completionReason: 'CUSTOMER_CONFIRMED',
        orderId: ORDER_ID,
      });
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: ORDER_ID,
      responseForHash: {
        order_completed: { completion_reason: 'CUSTOMER_CONFIRMED', order_id: ORDER_ID },
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(current.fulfillment.completeOrderInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('keeps the original completion HASH_ONLY fact after a shipped full refund changes the current reason', async () => {
    const current = harness();
    const record = { resource_id: ORDER_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockImplementationOnce(async () => {
      current.sequence.push('claim');
      return { kind: 'replay' as const, record };
    });
    current.fulfillment.getCompletedOrderForReplayInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('getReplay');
      return {
        ...result(),
        completionReason: 'FULL_REFUND_AFTER_SHIPMENT' as const,
        orderVersion: 6,
        shipmentStatus: 'DELIVERED' as const,
        shipmentVersion: 3,
      };
    });

    await expect(current.service.completeAdmin({
      actorAccountId: ADMIN_ACCOUNT_ID,
      expectedOrderVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
      orderId: ORDER_ID,
      reason: 'Delivery evidence verified',
      requestId: REQUEST_ID,
    })).resolves.toMatchObject({
      completionReason: 'FULL_REFUND_AFTER_SHIPMENT',
      orderId: ORDER_ID,
      orderVersion: 6,
    });

    expect(current.sequence).toEqual(['claim', 'getReplay', 'assertReplay']);
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: ORDER_ID,
      responseForHash: {
        order_completed: { completion_reason: 'ADMIN_FORCED', order_id: ORDER_ID },
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(current.fulfillment.completeOrderInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('does not append metadata or complete idempotency when domain completion fails', async () => {
    const current = harness();
    current.fulfillment.completeOrderInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('completeOrder');
      throw new Error('wallet invariant failed');
    });

    await expect(current.service.confirmCustomer({
      accountId: CUSTOMER_ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedOrderVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
      orderId: ORDER_ID,
      requestId: REQUEST_ID,
    })).rejects.toThrow('wallet invariant failed');

    expect(current.sequence).toEqual(['claim', 'completeOrder']);
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('stops before Outbox and idempotency completion when the completion audit fails', async () => {
    const current = harness();
    current.audit.append.mockImplementationOnce(async () => {
      current.sequence.push('audit');
      throw new Error('audit unavailable');
    });

    await expect(current.service.completeAdmin({
      actorAccountId: ADMIN_ACCOUNT_ID,
      expectedOrderVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
      orderId: ORDER_ID,
      reason: 'Delivery evidence verified',
      requestId: REQUEST_ID,
    })).rejects.toThrow('audit unavailable');

    expect(current.sequence).toEqual(['claim', 'completeOrder', 'audit']);
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('leaves idempotency incomplete when an in-transaction completion event cannot persist', async () => {
    const current = harness();
    current.outbox.append.mockImplementationOnce(async () => {
      current.sequence.push('outbox');
      throw new Error('outbox unavailable');
    });

    await expect(current.service.confirmCustomer({
      accountId: CUSTOMER_ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedOrderVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
      orderId: ORDER_ID,
      requestId: REQUEST_ID,
    })).rejects.toThrow('outbox unavailable');

    expect(current.sequence).toEqual(['claim', 'completeOrder', 'audit', 'outbox']);
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });
});
