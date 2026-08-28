import { Logger } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  DatabaseRuntime,
  StoreOrderCloseResult,
  StoreOrderSnapshot,
  StoreOrderTimeoutResult,
} from '@qingxu/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OrderTimeoutService,
  type OrderTimeoutAuditRepository,
  type OrderTimeoutOutboxRepository,
  type OrderTimeoutRepository,
} from './order-timeout.service';

const ORDER_ID = '01K00000000000000000000000';
const RESERVATION_ID = '01K00000000000000000000001';

const config = {
  worker: { pollIntervalMs: 1_000, batchSize: 3, maxRetries: 3, baseRetryDelayMs: 100 },
} as PlatformRuntimeConfig;

function order(overrides: Partial<StoreOrderSnapshot> = {}): StoreOrderSnapshot {
  return {
    amounts: { goods: '20.00', paid: '0.00', payable: '20.00', refunded: '0.00', shipping: '0.00' },
    closeReason: null,
    completionReason: null,
    createdAt: new Date('2026-08-29T00:00:00.000Z'),
    customerId: '01K00000000000000000000002',
    fulfillmentStatus: 'NOT_STARTED',
    items: [],
    orderId: ORDER_ID,
    orderNo: `QX${ORDER_ID}`,
    orderStatus: 'PENDING_PAYMENT',
    payExpiresAt: new Date('2026-08-29T00:30:00.000Z'),
    paymentResolution: 'NORMAL',
    paymentStatus: 'UNPAID',
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    serverTime: new Date('2026-08-29T00:31:00.000Z'),
    source: 'BUY_NOW',
    updatedAt: new Date('2026-08-29T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function closedResult(): StoreOrderCloseResult {
  const before = order();
  return {
    before,
    changed: true,
    order: order({
      closeReason: 'PAYMENT_TIMEOUT',
      fulfillmentStatus: 'NOT_STARTED',
      orderStatus: 'CLOSED',
      updatedAt: new Date('2026-08-29T00:31:00.000Z'),
      version: 2,
    }),
    reservationId: RESERVATION_ID,
  };
}

function createMocks(results: StoreOrderTimeoutResult[] = [{ kind: 'none' }]) {
  const transaction = { marker: 'transaction' };
  const prisma = {
    $transaction: vi.fn(async (work: (value: object) => Promise<unknown>) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const queue = [...results];
  const orders = {
    expireNextOrderInTransaction: vi.fn(async () => queue.shift() ?? { kind: 'none' }),
  } as unknown as OrderTimeoutRepository;
  const audit = { append: vi.fn(async () => ({})) } as unknown as OrderTimeoutAuditRepository;
  const outbox = { append: vi.fn(async () => ({})) } as unknown as OrderTimeoutOutboxRepository;
  return { audit, database, orders, outbox, prisma, transaction };
}

function createService(mocks = createMocks()): OrderTimeoutService {
  return new OrderTimeoutService(mocks.database, config, mocks.orders, mocks.audit, mocks.outbox);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('OrderTimeoutService', () => {
  it('closes at most one order per Serializable transaction and appends safe facts atomically', async () => {
    const result = closedResult();
    const mocks = createMocks([{ kind: 'closed', result }, { kind: 'none' }]);

    await createService(mocks).pollOnce();

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenNthCalledWith(1, mocks.transaction);
    expect(mocks.audit.append).toHaveBeenCalledWith(mocks.transaction, {
      action: 'CANCEL',
      after: { status: 'CLOSED', version: 2 },
      before: { status: 'PENDING_PAYMENT', version: 1 },
      module: 'order',
      objectId: ORDER_ID,
      objectType: 'order',
      requestId: expect.stringMatching(/^trace_[0-9a-f]{32}$/),
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    expect(mocks.outbox.append).toHaveBeenCalledWith(mocks.transaction, {
      aggregateId: ORDER_ID,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: ORDER_ID,
        resource_type: 'order',
        resource_version: 2,
      },
    });
    expect(JSON.stringify(vi.mocked(mocks.audit.append).mock.calls)).not.toContain('customerId');
  });

  it('stops immediately on none without writing audit or outbox facts', async () => {
    const mocks = createMocks([{ kind: 'none' }]);

    await createService(mocks).pollOnce();

    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledOnce();
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('continues after skipped and never exceeds the configured batch size', async () => {
    const mocks = createMocks([
      { kind: 'skipped' },
      { kind: 'skipped' },
      { kind: 'skipped' },
      { kind: 'closed', result: closedResult() },
    ]);

    await createService(mocks).pollOnce();

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(config.worker.batchSize);
    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledTimes(config.worker.batchSize);
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('continues after skipped and writes facts for a later closed order', async () => {
    const mocks = createMocks([
      { kind: 'skipped' },
      { kind: 'closed', result: closedResult() },
      { kind: 'none' },
    ]);

    await createService(mocks).pollOnce();

    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledTimes(3);
    expect(mocks.audit.append).toHaveBeenCalledOnce();
    expect(mocks.outbox.append).toHaveBeenCalledOnce();
  });

  it('logs only a fixed code when the database transaction fails', async () => {
    const mocks = createMocks([{ kind: 'closed', result: closedResult() }]);
    vi.mocked(mocks.prisma.$transaction).mockRejectedValue(new Error('database password and customer address'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).pollOnce();

    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ code: 'ORDER_TIMEOUT_POLL_FAILED' });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('database password');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('customer address');
  });

  it('does not start a second poll while the first transaction is running', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mocks = createMocks([{ kind: 'none' }]);
    vi.mocked(mocks.orders.expireNextOrderInTransaction).mockImplementation(async () => {
      await blocked;
      return { kind: 'none' };
    });
    const service = createService(mocks);

    const first = service.pollOnce();
    await Promise.resolve();
    await service.pollOnce();
    release?.();
    await first;

    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledOnce();
  });

  it('waits for in-flight work during shutdown and does not own the database lifecycle', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mocks = createMocks([{ kind: 'none' }]);
    vi.mocked(mocks.orders.expireNextOrderInTransaction).mockImplementation(async () => {
      await blocked;
      return { kind: 'none' };
    });
    const service = createService(mocks);
    const poll = service.pollOnce();
    await Promise.resolve();

    const shutdown = service.onApplicationShutdown();
    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    release?.();
    await poll;
    await vi.runAllTimersAsync();
    await shutdown;

    expect(shutdownFinished).toBe(true);
    expect('connect' in mocks.database).toBe(false);
    expect('disconnect' in mocks.database).toBe(false);
    await service.pollOnce();
    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledOnce();
  });
});
