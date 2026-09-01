import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StoreAftersaleRepository,
  type StoreAftersalePreviewInput,
} from './store-aftersale.repository';

const NOW = new Date('2026-09-01T06:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const accountId = id(-30_000);
const customerId = id(-29_000);
const orderId = id(-28_000);
const orderItemId = id(-27_000);
const secondOrderItemId = id(-26_000);
const fileId = id(-25_000);
const aftersaleId = id(-24_000);
const aftersaleItemId = id(-23_000);

function activeAccount() {
  return {
    customer_profile: { account_id: accountId, anonymized_at: null, id: customerId },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'openid-store-aftersale',
  };
}

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_reserved_amount: new Prisma.Decimal('0.00'),
    aftersale_reserved_qty: 0,
    id: orderItemId,
    line_paid_amount: new Prisma.Decimal('37.50'),
    quantity: 3,
    refunded_amount: new Prisma.Decimal('0.00'),
    refunded_qty: 0,
    unit_price: new Prisma.Decimal('12.50'),
    version: 4,
    ...overrides,
  };
}

function ownedOrder(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_expires_at: null,
    completed_at: null,
    fulfillment_status: 'READY_TO_SHIP',
    id: orderId,
    items: [orderItem()],
    order_status: 'PENDING_SHIPMENT',
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    version: 7,
    ...overrides,
  };
}

function evidenceFile(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_evidence: [],
    created_by_id: accountId,
    deleted_at: null,
    id: fileId,
    object_key: `private/${fileId}`,
    purpose: 'AFTERSALE_EVIDENCE',
    status: 'READY',
    visibility: 'PRIVATE',
    ...overrides,
  };
}

function input(overrides: Partial<StoreAftersalePreviewInput> = {}): StoreAftersalePreviewInput {
  return {
    accountId,
    customerId,
    evidenceFileIds: [fileId],
    items: [{ orderItemId, quantity: 2 }],
    orderId,
    reasonCode: 'QUALITY_ISSUE',
    reasonText: ' product quality issue ',
    type: 'REFUND_ONLY',
    ...overrides,
  };
}

function sqlText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
}

function previewHarness() {
  let order: ReturnType<typeof ownedOrder> | null = ownedOrder();
  let files = [evidenceFile()];
  let account: ReturnType<typeof activeAccount> | null = activeAccount();
  const transaction = {
    $queryRaw: vi.fn(async (query: unknown) => {
      if (sqlText(query).includes('transaction_timestamp')) return [{ transaction_time: NOW }];
      throw new Error(`Unexpected SQL: ${sqlText(query)}`);
    }),
    account: { findUnique: vi.fn(async () => account) },
    fileAsset: { findMany: vi.fn(async () => files) },
    salesOrder: { findFirst: vi.fn(async () => order) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) =>
      work(transaction as unknown as DatabaseTransaction)),
  };
  return {
    prisma,
    repository: new StoreAftersaleRepository(prisma as unknown as PrismaClient),
    setAccount: (value: ReturnType<typeof activeAccount> | null) => { account = value; },
    setFiles: (value: ReturnType<typeof evidenceFile>[]) => { files = value; },
    setOrder: (value: ReturnType<typeof ownedOrder> | null) => { order = value; },
    transaction,
  };
}

function detailRecord(
  idValue: string,
  itemData: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  orderVersion = 8,
) {
  return {
    aftersale_no: `AS${idValue}`,
    cancelled_at: null,
    completed_at: null,
    created_at: NOW,
    customer_id: customerId,
    evidence: [{ file_id: fileId, purpose: 'APPLICATION', return_inspection_id: null }],
    id: idValue,
    items: [{
      id: id(-20_000),
      order_item: { product_name_snapshot: 'Fixture Product', sku_name_snapshot: 'Fixture SKU' },
      order_item_id: orderItemId,
      refunded_amount: new Prisma.Decimal('0.00'),
      refunded_qty: 0,
      requested_amount: itemData.requested_amount ?? new Prisma.Decimal('25.00'),
      requested_qty: itemData.requested_qty ?? 2,
      reserved_amount: itemData.reserved_amount ?? new Prisma.Decimal('25.00'),
      reserved_qty: itemData.reserved_qty ?? 2,
    }],
    order: {
      fulfillment_status: 'READY_TO_SHIP',
      id: orderId,
      order_no: `QX${orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_at: new Date(NOW.getTime() - 60_000),
      payable_amount: new Prisma.Decimal('37.50'),
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      version: orderVersion,
    },
    order_id: orderId,
    reason_code: 'QUALITY_ISSUE',
    reason_text: 'product quality issue',
    refunds: [],
    return_address: null,
    return_inspection: null,
    return_shipment: null,
    review_reason: null,
    reviewed_at: null,
    reviewed_by_id: null,
    status: 'PENDING_REVIEW',
    type: 'REFUND_ONLY',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function confirmHarness() {
  const events: string[] = [];
  let createdAftersale: Record<string, unknown> | null = null;
  let createdItems: Record<string, unknown>[] = [];
  let createdEvidence: Record<string, unknown>[] = [];
  let reservedQuantity = 0;
  let reservedAmount = new Prisma.Decimal('0.00');
  let itemVersion = 4;
  let orderVersion = 7;
  let failQuotaCas = false;
  const transaction = {
    $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
      events.push(`advisory:${namespace}`);
      return [{ acquired: 1 }];
    }),
    $queryRaw: vi.fn(async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
      if (text.includes('FROM public.sales_order')) {
        events.push('row-lock:order');
        return [{ id: orderId }];
      }
      if (text.includes('FROM public.order_item')) {
        events.push('row-lock:items');
        return [{ id: orderItemId }];
      }
      if (text.includes('FROM public.aftersale_item')) {
        events.push('row-lock:aftersale-items');
        return [];
      }
      if (text.includes('FROM public.aftersale')) {
        events.push('row-lock:aftersales');
        return [];
      }
      if (text.includes('FROM public.file_asset')) {
        events.push('row-lock:evidence');
        return [{ id: fileId }];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }),
    account: { findUnique: vi.fn(async () => activeAccount()) },
    aftersale: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('write:aftersale');
        createdAftersale = data;
        return { id: data.id };
      }),
      findFirst: vi.fn(async ({ include }: { include?: unknown }) => {
        if (!include || createdAftersale === null) return null;
        return detailRecord(createdAftersale.id as string, createdItems[0] ?? {}, {}, orderVersion);
      }),
    },
    aftersaleEvidence: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        events.push('write:evidence');
        createdEvidence = data;
        return { count: data.length };
      }),
    },
    aftersaleItem: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        events.push('write:items');
        createdItems = data;
        return { count: data.length };
      }),
    },
    fileAsset: { findMany: vi.fn(async () => [evidenceFile()]) },
    auditLog: { findMany: vi.fn(async () => []) },
    orderItem: {
      updateMany: vi.fn(async ({ data, where }: {
        data: { aftersale_reserved_amount: Prisma.Decimal; aftersale_reserved_qty: number };
        where: { version: number };
      }) => {
        events.push('write:quota');
        if (failQuotaCas || where.version !== itemVersion) return { count: 0 };
        reservedQuantity = data.aftersale_reserved_qty;
        reservedAmount = data.aftersale_reserved_amount;
        itemVersion += 1;
        return { count: 1 };
      }),
    },
    salesOrder: {
      findFirst: vi.fn(async () => ownedOrder({
        items: [orderItem({
          aftersale_reserved_amount: reservedAmount,
          aftersale_reserved_qty: reservedQuantity,
          version: itemVersion,
        })],
        version: orderVersion,
      })),
      updateMany: vi.fn(async ({ where }: { where: { version: number } }) => {
        events.push('write:order-version');
        if (where.version !== orderVersion) return { count: 0 };
        orderVersion += 1;
        return { count: 1 };
      }),
    },
  };
  return {
    created: () => ({ aftersale: createdAftersale, evidence: createdEvidence, items: createdItems }),
    events,
    failQuotaCas: () => { failQuotaCas = true; },
    orderVersion: () => orderVersion,
    repository: new StoreAftersaleRepository({} as PrismaClient),
    transaction: transaction as unknown as DatabaseTransaction,
    transactionStub: transaction,
  };
}

describe('StoreAftersaleRepository', () => {
  it('strictly validates the closed request before opening a transaction', async () => {
    const state = previewHarness();
    await expect(state.repository.preview({ ...input(), extra: true } as never))
      .rejects.toThrow('invalid fields');
    await expect(state.repository.preview(input({ type: 'AMOUNT_COMPENSATION' as never })))
      .rejects.toThrow('type is invalid');
    await expect(state.repository.preview(input({ reasonCode: 'OTHER', reasonText: ' ' })))
      .rejects.toThrow('2 to 500');
    await expect(state.repository.preview(input({
      items: [{ orderItemId, quantity: 1 }, { orderItemId, quantity: 2 }],
    }))).rejects.toThrow('must be unique');
    await expect(state.repository.preview(input({ evidenceFileIds: Array(10).fill(fileId) })))
      .rejects.toThrow('at most 9');
    await expect(state.repository.listOwnedAftersalesInTransaction(
      state.transaction as unknown as DatabaseTransaction,
      {
        accountId,
        aftersaleNo: 'A'.repeat(33),
        customerId,
        page: 1,
        pageSize: 20,
      },
    )).rejects.toThrow('number filter is invalid');
    expect(state.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns a canonical Repeatable Read preview with server money, versions and evidence facts', async () => {
    const state = previewHarness();
    const result = await state.repository.preview(input());

    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(result).toMatchObject({
      blockers: [],
      canSubmit: true,
      customerId,
      evidence: [{
        attachedAftersaleIds: [],
        createdByAccountId: accountId,
        fileId,
        valid: true,
      }],
      items: [{
        allocatedAmount: '25.00',
        linePaidAmount: '37.50',
        orderItemId,
        orderItemVersion: 4,
        remainingRefundableAmount: '37.50',
        remainingRefundableQuantity: 3,
        requestedQuantity: 2,
      }],
      order: { orderId, orderVersion: 7, orderStatus: 'PENDING_SHIPMENT' },
      reasonText: 'product quality issue',
      requestedAmount: '25.00',
    });
  });

  it('returns all closed blockers without leaking cross-resource existence or writing facts', async () => {
    const state = previewHarness();
    state.setOrder(ownedOrder({
      items: [orderItem({
        aftersale_reserved_amount: new Prisma.Decimal('25.00'),
        aftersale_reserved_qty: 2,
      })],
      order_status: 'CLOSED',
    }));
    state.setFiles([evidenceFile({
      aftersale_evidence: [{ aftersale_id: aftersaleId }],
      created_by_id: id(-10_000),
    })]);

    const result = await state.repository.preview(input({
      items: [{ orderItemId, quantity: 2 }, { orderItemId: secondOrderItemId, quantity: 1 }],
    }));

    expect(result.canSubmit).toBe(false);
    expect(result.blockers).toEqual([
      'ORDER_NOT_ELIGIBLE',
      'ITEM_UNAVAILABLE',
      'AFTERSALE_QUOTA_EXCEEDED',
      'EVIDENCE_UNAVAILABLE',
    ]);
    expect(result.evidence[0]).toMatchObject({ attachedAftersaleIds: [aftersaleId], valid: false });
    expect(state.transaction.salesOrder.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      expected: false,
      label: 'rejects a pending shipment Order carrying a completion timestamp',
      order: { completed_at: NOW, order_status: 'PENDING_SHIPMENT' },
    },
    {
      expected: false,
      label: 'rejects a shipping Order carrying a completion timestamp',
      order: { completed_at: NOW, order_status: 'SHIPPING' },
    },
    {
      expected: true,
      label: 'accepts a completed Order inside its aftersale window',
      order: {
        aftersale_expires_at: new Date(NOW.getTime() + 1_000),
        completed_at: new Date(NOW.getTime() - 1_000),
        order_status: 'COMPLETED',
      },
    },
    {
      expected: false,
      label: 'rejects a completed Order without its completion timestamp',
      order: { aftersale_expires_at: new Date(NOW.getTime() + 1_000), order_status: 'COMPLETED' },
    },
    {
      expected: false,
      label: 'rejects a completed Order after its aftersale window',
      order: {
        aftersale_expires_at: new Date(NOW.getTime() - 1),
        completed_at: new Date(NOW.getTime() - 2_000),
        order_status: 'COMPLETED',
      },
    },
  ])('$label', async ({ expected, order }) => {
    const state = previewHarness();
    state.setOrder(ownedOrder(order));

    const result = await state.repository.preview(input());

    expect(result.canSubmit).toBe(expected);
    expect(result.blockers.includes('ORDER_NOT_ELIGIBLE')).toBe(!expected);
  });

  it('returns closed Order axes and a stable audit-backed aftersale timeline', async () => {
    const [cancelAuditId, createAuditId] = [id(-19_000), id(-19_000)].sort();
    const transaction = {
      account: { findUnique: vi.fn(async () => activeAccount()) },
      aftersale: {
        findFirst: vi.fn(async () => detailRecord(aftersaleId, {}, {
          cancelled_at: NOW,
          status: 'CANCELLED',
          version: 2,
        }, 9)),
      },
      auditLog: {
        findMany: vi.fn(async () => [
          {
            action: 'CANCEL',
            actor_role: 'CUSTOMER',
            after_json: { status: 'CANCELLED', version: 2 },
            before_json: { status: 'PENDING_REVIEW', version: 1 },
            id: cancelAuditId,
            occurred_at: NOW,
          },
          {
            action: 'CREATE',
            actor_role: 'CUSTOMER',
            after_json: { status: 'PENDING_REVIEW', version: 1 },
            before_json: null,
            id: createAuditId,
            occurred_at: NOW,
          },
        ]),
      },
    };
    const repository = new StoreAftersaleRepository({} as PrismaClient);

    const result = await repository.getOwnedAftersaleDetailInTransaction(
      transaction as unknown as DatabaseTransaction,
      { accountId, aftersaleId, customerId },
    );

    expect(result.order).toMatchObject({
      fulfillmentStatus: 'READY_TO_SHIP',
      orderStatus: 'PENDING_SHIPMENT',
      paymentResolution: 'NORMAL',
      paymentStatus: 'PAID',
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'NONE',
      version: 9,
    });
    expect(result.timeline).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        auditId: createAuditId,
        fromStatus: null,
        toStatus: 'PENDING_REVIEW',
      }),
      expect.objectContaining({
        action: 'CANCEL',
        auditId: cancelAuditId,
        fromStatus: 'PENDING_REVIEW',
        toStatus: 'CANCELLED',
      }),
    ]);
    expect(transaction.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
    }));
  });

  it('fails closed when an aftersale audit summary has no valid version', async () => {
    const transaction = {
      account: { findUnique: vi.fn(async () => activeAccount()) },
      aftersale: { findFirst: vi.fn(async () => detailRecord(aftersaleId, {})) },
      auditLog: {
        findMany: vi.fn(async () => [{
          action: 'CREATE',
          actor_role: 'CUSTOMER',
          after_json: { status: 'PENDING_REVIEW' },
          before_json: null,
          id: id(-19_000),
          occurred_at: NOW,
        }]),
      },
    };
    const repository = new StoreAftersaleRepository({} as PrismaClient);

    await expect(repository.getOwnedAftersaleDetailInTransaction(
      transaction as unknown as DatabaseTransaction,
      { accountId, aftersaleId, customerId },
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('returns a neutral 404 without reading audit facts for an unowned aftersale', async () => {
    const transaction = {
      account: { findUnique: vi.fn(async () => activeAccount()) },
      aftersale: { findFirst: vi.fn(async () => null) },
      auditLog: { findMany: vi.fn(async () => []) },
    };
    const repository = new StoreAftersaleRepository({} as PrismaClient);

    await expect(repository.getOwnedAftersaleDetailInTransaction(
      transaction as unknown as DatabaseTransaction,
      { accountId, aftersaleId, customerId },
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(transaction.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('locks order, items, aftersales and evidence before atomically reserving and creating immutable facts', async () => {
    const state = confirmHarness();
    const verifyPreview = vi.fn((snapshot) => {
      expect(snapshot.canSubmit).toBe(true);
      expect(snapshot.requestedAmount).toBe('25.00');
    });
    const result = await state.repository.confirmAftersaleInTransaction(
      state.transaction,
      input(),
      { verifyPreview },
    );

    expect(verifyPreview).toHaveBeenCalledTimes(1);
    expect(result.aftersale).toMatchObject({
      aftersaleNo: `AS${result.aftersale.aftersaleId}`,
      availableActions: ['CANCEL', 'VIEW_ORDER'],
      requestedAmount: '25.00',
      status: 'PENDING_REVIEW',
      version: 1,
      order: { version: 8 },
    });
    expect(result.audit).toEqual({ after: { status: 'PENDING_REVIEW', version: 1 }, before: null });
    expect(state.created().items).toEqual([
      expect.objectContaining({
        order_item_id: orderItemId,
        requested_amount: new Prisma.Decimal('25.00'),
        requested_qty: 2,
        reserved_amount: new Prisma.Decimal('25.00'),
        reserved_qty: 2,
      }),
    ]);
    expect(state.created().evidence).toEqual([
      expect.objectContaining({ file_id: fileId, purpose: 'APPLICATION', return_inspection_id: null }),
    ]);
    const orderLock = state.events.indexOf('row-lock:order');
    const itemLock = state.events.indexOf('row-lock:items');
    const aftersaleLock = state.events.indexOf('row-lock:aftersales');
    const aftersaleItemLock = state.events.indexOf('row-lock:aftersale-items');
    const evidenceLock = state.events.indexOf('row-lock:evidence');
    const quotaWrite = state.events.indexOf('write:quota');
    const orderVersionWrite = state.events.indexOf('write:order-version');
    expect(orderLock).toBeGreaterThan(-1);
    expect(itemLock).toBeGreaterThan(orderLock);
    expect(aftersaleLock).toBeGreaterThan(itemLock);
    expect(aftersaleItemLock).toBeGreaterThan(aftersaleLock);
    expect(evidenceLock).toBeGreaterThan(aftersaleItemLock);
    expect(quotaWrite).toBeGreaterThan(evidenceLock);
    expect(orderVersionWrite).toBeGreaterThan(quotaWrite);
    expect(state.orderVersion()).toBe(8);
  });

  it('fails confirmation before any write when evidence was already attached to another aftersale', async () => {
    const state = confirmHarness();
    state.transactionStub.fileAsset.findMany.mockResolvedValue([
      evidenceFile({ aftersale_evidence: [{ aftersale_id: aftersaleId }] }),
    ] as never);

    await expect(state.repository.confirmAftersaleInTransaction(
      state.transaction,
      input(),
      { verifyPreview: () => undefined },
    )).rejects.toMatchObject({ code: 'AFTERSALE_REQUOTE_REQUIRED' });
    expect(state.transactionStub.orderItem.updateMany).not.toHaveBeenCalled();
    expect(state.transactionStub.aftersale.create).not.toHaveBeenCalled();
  });

  it('loses a competing quota CAS without creating an aftersale or changing the Order version', async () => {
    const state = confirmHarness();
    state.failQuotaCas();

    await expect(state.repository.confirmAftersaleInTransaction(
      state.transaction,
      input(),
      { verifyPreview: () => undefined },
    )).rejects.toMatchObject({ code: 'AFTERSALE_REQUOTE_REQUIRED' });
    expect(state.transactionStub.aftersale.create).not.toHaveBeenCalled();
    expect(state.transactionStub.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(state.orderVersion()).toBe(7);
  });

  it('releases the exact reservation once when cancelling an allowed owned aftersale', async () => {
    const events: string[] = [];
    let status = 'PENDING_REVIEW';
    let version = 3;
    let reservedQuantity = 2;
    let reservedAmount = new Prisma.Decimal('25.00');
    let orderVersion = 8;
    const transaction = {
      $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
        events.push(`advisory:${namespace}`);
        return [{ acquired: 1 }];
      }),
      $queryRaw: vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
        if (text.includes('FROM public.sales_order')) {
          events.push('row-lock:order');
          return [{ id: orderId }];
        }
        if (text.includes('FROM public.order_item')) {
          events.push('row-lock:items');
          return [{ id: orderItemId }];
        }
        if (text.includes('FROM public.aftersale_item')) {
          events.push('row-lock:aftersale-items');
          return [{ id: aftersaleItemId }];
        }
        if (text.includes('FROM public.aftersale')) {
          events.push('row-lock:aftersales');
          return [{ id: aftersaleId }];
        }
        return [];
      }),
      account: { findUnique: vi.fn(async () => activeAccount()) },
      aftersale: {
        findFirst: vi.fn(async (args: { include?: unknown; select?: Record<string, unknown> }) => {
          if (args.include) {
            return detailRecord(aftersaleId, {}, {
              cancelled_at: NOW,
              status,
              version,
            }, orderVersion);
          }
          if (args.select && Object.keys(args.select).length === 1 && args.select.order_id === true) {
            return { order_id: orderId };
          }
          return {
            id: aftersaleId,
            items: [{
              order_item_id: orderItemId,
              refunded_amount: new Prisma.Decimal('0.00'),
              refunded_qty: 0,
              reserved_amount: new Prisma.Decimal('25.00'),
              reserved_qty: 2,
            }],
            order_id: orderId,
            refunds: [],
            return_shipment: null,
            status,
            version,
          };
        }),
        updateMany: vi.fn(async () => {
          status = 'CANCELLED';
          version += 1;
          return { count: 1 };
        }),
      },
      auditLog: { findMany: vi.fn(async () => []) },
      orderItem: {
        findMany: vi.fn(async () => [{
          aftersale_reserved_amount: reservedAmount,
          aftersale_reserved_qty: reservedQuantity,
          id: orderItemId,
          order_id: orderId,
          version: 6,
        }]),
        updateMany: vi.fn(async ({ data }: {
          data: { aftersale_reserved_amount: Prisma.Decimal; aftersale_reserved_qty: number };
        }) => {
          reservedAmount = data.aftersale_reserved_amount;
          reservedQuantity = data.aftersale_reserved_qty;
          return { count: 1 };
        }),
      },
      salesOrder: {
        findUnique: vi.fn(async () => ({ id: orderId, version: orderVersion })),
        updateMany: vi.fn(async ({ where }: { where: { version: number } }) => {
          if (where.version !== orderVersion) return { count: 0 };
          orderVersion += 1;
          return { count: 1 };
        }),
      },
    };
    const repository = new StoreAftersaleRepository({} as PrismaClient);
    const result = await repository.cancelOwnedAftersaleInTransaction(
      transaction as unknown as DatabaseTransaction,
      { accountId, aftersaleId, customerId, expectedVersion: 3 },
    );

    expect(reservedQuantity).toBe(0);
    expect(reservedAmount.toFixed(2)).toBe('0.00');
    expect(result).toMatchObject({
      aftersale: { order: { version: 9 }, status: 'CANCELLED', version: 4 },
      audit: {
        after: { status: 'CANCELLED', version: 4 },
        before: { status: 'PENDING_REVIEW', version: 3 },
      },
      changed: true,
    });
    expect(transaction.orderItem.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.aftersale.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledTimes(1);
    const orderLock = events.indexOf('row-lock:order');
    const itemLock = events.indexOf('row-lock:items');
    const aftersaleLock = events.indexOf('row-lock:aftersales');
    const aftersaleItemLock = events.indexOf('row-lock:aftersale-items');
    expect(itemLock).toBeGreaterThan(orderLock);
    expect(aftersaleLock).toBeGreaterThan(itemLock);
    expect(aftersaleItemLock).toBeGreaterThan(aftersaleLock);
    expect(orderVersion).toBe(9);
  });
});
