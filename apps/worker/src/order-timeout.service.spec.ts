import { Logger } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  DatabaseRuntime,
  StoreOrderCloseResult,
  StoreOrderSnapshot,
  StoreOrderTimeoutIntegrityIssue,
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
const SECOND_ORDER_ID = '01K00000000000000000000003';
const THIRD_ORDER_ID = '01K00000000000000000000004';
const INTEGRITY_EXPIRY = new Date('2026-08-29T00:30:00.000Z');

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

function createMocks(
  results: StoreOrderTimeoutResult[] = [{ kind: 'none' }],
  integrityIssues: StoreOrderTimeoutIntegrityIssue[] = [],
) {
  const transaction = { marker: 'transaction' };
  const prisma = {
    $transaction: vi.fn(async (work: (value: object) => Promise<unknown>) => work(transaction)),
  };
  const withPrismaTransaction = vi.fn(async (work: (value: object) => Promise<unknown>) => work(transaction));
  const database = { prisma, withPrismaTransaction } as unknown as DatabaseRuntime;
  const queue = [...results];
  const orders = {
    expireNextOrderInTransaction: vi.fn(async () => queue.shift() ?? { kind: 'none' }),
    listExpiredOrderIntegrityIssues: vi.fn(async () => integrityIssues),
  } as unknown as OrderTimeoutRepository;
  const audit = { append: vi.fn(async () => ({})) } as unknown as OrderTimeoutAuditRepository;
  const outbox = { append: vi.fn(async () => ({})) } as unknown as OrderTimeoutOutboxRepository;
  return { audit, database, orders, outbox, prisma, transaction, withPrismaTransaction };
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

  it('reports bounded structured integrity alerts without PII and keeps the scan read-only', async () => {
    const mocks = createMocks([{ kind: 'none' }], [
      { issue: 'ORDER_RESERVATION_ITEMS_MISMATCH', orderId: ORDER_ID, payExpiresAt: INTEGRITY_EXPIRY },
      { issue: 'INVENTORY_BALANCE_INVALID', orderId: RESERVATION_ID, payExpiresAt: INTEGRITY_EXPIRY },
    ]);
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).pollOnce();

    expect(mocks.withPrismaTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(mocks.orders.listExpiredOrderIntegrityIssues).toHaveBeenCalledExactlyOnceWith(
      mocks.transaction,
      { limit: config.worker.batchSize },
    );
    expect(errorLog).toHaveBeenNthCalledWith(1, {
      code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
      issue: 'ORDER_RESERVATION_ITEMS_MISMATCH',
      orderId: ORDER_ID,
    });
    expect(errorLog).toHaveBeenNthCalledWith(2, {
      code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
      issue: 'INVENTORY_BALANCE_INVALID',
      orderId: RESERVATION_ID,
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/customer|address|recipient|phone/i);
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('does not repeat an unchanged integrity alert on every worker poll', async () => {
    const mocks = createMocks([{ kind: 'none' }], [
      { issue: 'ORDER_RESERVATION_ITEMS_MISMATCH', orderId: ORDER_ID, payExpiresAt: INTEGRITY_EXPIRY },
    ]);
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = createService(mocks);

    await service.pollOnce();
    await service.pollOnce();

    expect(mocks.orders.listExpiredOrderIntegrityIssues).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledExactlyOnceWith({
      code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
      issue: 'ORDER_RESERVATION_ITEMS_MISMATCH',
      orderId: ORDER_ID,
    });
  });

  it('advances through every integrity page and suppresses unchanged alerts after wrapping', async () => {
    const firstPage: StoreOrderTimeoutIntegrityIssue[] = [
      { issue: 'ORDER_ITEMS_MISSING', orderId: ORDER_ID, payExpiresAt: INTEGRITY_EXPIRY },
      { issue: 'ACTIVE_RESERVATION_MISSING', orderId: RESERVATION_ID, payExpiresAt: INTEGRITY_EXPIRY },
      { issue: 'INVENTORY_BALANCE_INVALID', orderId: SECOND_ORDER_ID, payExpiresAt: INTEGRITY_EXPIRY },
    ];
    const finalPage: StoreOrderTimeoutIntegrityIssue[] = [
      {
        issue: 'ORDER_RESERVATION_ITEMS_MISMATCH',
        orderId: THIRD_ORDER_ID,
        payExpiresAt: new Date(INTEGRITY_EXPIRY.getTime() + 1_000),
      },
    ];
    const mocks = createMocks([{ kind: 'none' }]);
    vi.mocked(mocks.orders.listExpiredOrderIntegrityIssues)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage)
      .mockResolvedValueOnce(firstPage);
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = createService(mocks);

    await service.pollOnce();
    await service.pollOnce();
    await service.pollOnce();

    expect(mocks.orders.listExpiredOrderIntegrityIssues).toHaveBeenNthCalledWith(1, mocks.transaction, {
      limit: config.worker.batchSize,
    });
    expect(mocks.orders.listExpiredOrderIntegrityIssues).toHaveBeenNthCalledWith(2, mocks.transaction, {
      after: {
        orderId: SECOND_ORDER_ID,
        payExpiresAt: INTEGRITY_EXPIRY,
      },
      limit: config.worker.batchSize,
    });
    expect(mocks.orders.listExpiredOrderIntegrityIssues).toHaveBeenNthCalledWith(3, mocks.transaction, {
      limit: config.worker.batchSize,
    });
    expect(errorLog).toHaveBeenCalledTimes(4);
    expect(errorLog).toHaveBeenCalledWith({
      code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
      issue: 'ORDER_RESERVATION_ITEMS_MISMATCH',
      orderId: THIRD_ORDER_ID,
    });
  });

  it('uses a fixed scan failure alert and still processes timeout candidates', async () => {
    const mocks = createMocks([{ kind: 'closed', result: closedResult() }, { kind: 'none' }]);
    vi.mocked(mocks.orders.listExpiredOrderIntegrityIssues)
      .mockRejectedValue(new Error('customer phone and address leaked by database'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).pollOnce();

    expect(errorLog).toHaveBeenCalledExactlyOnceWith({ code: 'ORDER_TIMEOUT_INTEGRITY_SCAN_FAILED' });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('customer phone');
    expect(mocks.orders.expireNextOrderInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.audit.append).toHaveBeenCalledOnce();
    expect(mocks.outbox.append).toHaveBeenCalledOnce();
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
