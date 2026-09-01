import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  AdminAftersaleRepository,
  type AdminAftersaleApproveHooks,
} from './admin-aftersale.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-01T09:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const actorAccountId = id(-50_000);
const customerId = id(-49_000);
const orderId = id(-48_000);
const orderItemId = id(-47_000);
const skuId = id(-46_000);
const aftersaleId = id(-45_000);
const aftersaleItemId = id(-44_000);
const sourceVersionId = id(-43_000);

function sqlText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
}

function detailRecord(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_no: `AS${aftersaleId}`,
    completed_at: null,
    created_at: NOW,
    customer_id: customerId,
    evidence: [],
    id: aftersaleId,
    items: [{
      id: aftersaleItemId,
      order_item: {
        product_name_snapshot: 'Fixture Product',
        sku_id: skuId,
        sku_name_snapshot: 'Fixture SKU',
      },
      order_item_id: orderItemId,
      refunded_amount: new Prisma.Decimal('0.00'),
      refunded_qty: 0,
      requested_amount: new Prisma.Decimal('25.00'),
      requested_qty: 2,
      reserved_amount: new Prisma.Decimal('25.00'),
      reserved_qty: 2,
    }],
    order_id: orderId,
    reason_code: 'QUALITY_ISSUE',
    reason_text: 'fixture quality issue',
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

function approveHarness(type: 'REFUND_ONLY' | 'RETURN_REFUND' = 'REFUND_ONLY') {
  const events: string[] = [];
  let status = 'PENDING_REVIEW';
  let version = 1;
  let orderVersion = 7;
  let returnAddress: Record<string, unknown> | null = null;
  let publishedAddressAvailable = true;
  const transaction = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes('FROM public.account')) {
        events.push('lock:actor');
        return [{
          deleted_at: null,
          has_password: true,
          id: actorAccountId,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        }];
      }
      if (text.includes('FROM public.sales_order')) {
        events.push('lock:order');
        return [{ id: orderId }];
      }
      if (text.includes('FROM public.order_item')) {
        events.push('lock:order-items');
        return [{ id: orderItemId }];
      }
      if (text.includes('FROM public.aftersale_item')) {
        events.push('lock:aftersale-items');
        return [{ id: aftersaleItemId }];
      }
      if (text.includes('FROM public.aftersale')) {
        events.push('lock:aftersales');
        return [{ id: aftersaleId }];
      }
      if (text.includes('FROM public.return_address_version')) {
        events.push('lock:return-address');
        return publishedAddressAvailable ? [{ id: sourceVersionId }] : [];
      }
      if (text.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
      throw new Error(`Unexpected SQL: ${text}`);
    }),
    aftersale: {
      findUnique: vi.fn(async (args: { include?: unknown; select?: Record<string, unknown> }) => {
        if (args.select && args.select.order_id === true && args.select.type === true) {
          return { order_id: orderId, type };
        }
        if (args.include) {
          return detailRecord({ return_address: returnAddress, status, type, version });
        }
        return null;
      }),
      updateMany: vi.fn(async ({ data, where }: {
        data: { status: string };
        where: { status: string; version: number };
      }) => {
        events.push('write:aftersale');
        if (where.status !== status || where.version !== version) return { count: 0 };
        status = data.status;
        version += 1;
        return { count: 1 };
      }),
    },
    returnAddressSnapshot: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('write:return-address-snapshot');
        returnAddress = {
          ...data,
          id: data.id,
          source_version: { id: sourceVersionId, version_no: 3 },
        };
        return { id: data.id };
      }),
    },
    returnAddressVersion: {
      findUnique: vi.fn(async () => ({
        city: 'Fixture City',
        detail_ciphertext: Buffer.from('source-detail'),
        district: 'Fixture District',
        effective_at: NOW,
        encryption_key_id: 'source-key',
        id: sourceVersionId,
        phone_ciphertext: Buffer.from('source-phone'),
        phone_last4: '+ -1',
        province: 'Fixture Province',
        recipient_name: 'Fixture Recipient',
        status: 'PUBLISHED',
        version_no: 3,
      })),
    },
    salesOrder: {
      findUnique: vi.fn(async () => ({ version: orderVersion })),
      updateMany: vi.fn(async ({ where }: { where: { version: number } }) => {
        events.push('write:order');
        if (where.version !== orderVersion) return { count: 0 };
        orderVersion += 1;
        return { count: 1 };
      }),
    },
  };
  return {
    events,
    repository: new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 7)),
    setPublishedAddressAvailable(value: boolean) { publishedAddressAvailable = value; },
    transaction: transaction as unknown as DatabaseTransaction,
    transactionStub: transaction,
  };
}

describe('AdminAftersaleRepository', () => {
  it('uses stable newest-first pagination and only customer aftersale types', async () => {
    const transaction = {
      aftersale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
    };
    const repository = new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 1));

    await expect(repository.listInTransaction(transaction as unknown as DatabaseTransaction, {
      page: 2,
      pageSize: 20,
    })).resolves.toEqual({ items: [], total: 0 });
    expect(transaction.aftersale.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
      where: { type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] } },
    }));
  });

  it('projects complete inspection lines, operator summary and application evidence', async () => {
    const inspectionId = id(-42_000);
    const applicationEvidenceId = id(-41_000);
    const inspectionEvidenceId = id(-40_000);
    const record = detailRecord({
      evidence: [
        { file_id: applicationEvidenceId, purpose: 'APPLICATION', return_inspection_id: null },
        { file_id: inspectionEvidenceId, purpose: 'INSPECTION', return_inspection_id: inspectionId },
      ],
      return_inspection: {
        abnormal_reason: null,
        evidence: [{ file_id: inspectionEvidenceId }],
        id: inspectionId,
        inspected_at: NOW,
        inspected_by: { id: actorAccountId, role: 'SUPER_ADMIN' },
        items: [{
          approved_refund_qty: 2,
          damaged_qty: 0,
          note: 'sealed fixture',
          order_item_id: orderItemId,
          received_qty: 2,
          restock_qty: 2,
          return_to_customer_qty: 0,
          scrap_qty: 0,
        }],
        resolution: null,
        resolution_note: null,
        resolved_at: null,
        status: 'PASS',
      },
      status: 'REFUNDING_AFTER_RETURN',
      type: 'RETURN_REFUND',
    });
    const transaction = {
      aftersale: { findUnique: vi.fn(async () => record) },
      auditLog: { findMany: vi.fn(async () => []) },
    };
    const repository = new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 2));
    (repository as unknown as { fulfillment: { getAdminOrderDetailInTransaction: () => Promise<unknown> } })
      .fulfillment = {
        getAdminOrderDetailInTransaction: vi.fn(async () => ({ commissionImpact: [], inventoryImpact: [] })),
      };

    const detail = await repository.getDetailInTransaction(
      transaction as unknown as DatabaseTransaction,
      { aftersaleId },
    );
    expect(detail.applicationEvidenceFileIds).toEqual([applicationEvidenceId]);
    expect(detail.items[0]?.approvedRefundQuantity).toBe(2);
    expect(detail.inspection).toMatchObject({
      evidenceFileIds: [inspectionEvidenceId],
      inspectedBy: { accountId: actorAccountId, displayName: '总部管理员' },
      items: [{
        approvedRefundQuantity: 2,
        note: 'sealed fixture',
        orderItemId,
        receivedQuantity: 2,
        restockQuantity: 2,
      }],
    });
  });

  it('replays the current full inspection projection after later lifecycle progress', async () => {
    const inspectionId = id(-42_000);
    const inspectionEvidenceId = id(-40_000);
    const record = detailRecord({
      return_inspection: {
        abnormal_reason: 'fixture mismatch',
        evidence: [{ file_id: inspectionEvidenceId }],
        id: inspectionId,
        inspected_at: NOW,
        inspected_by: { id: actorAccountId, role: 'SUPER_ADMIN' },
        items: [{
          approved_refund_qty: 1,
          damaged_qty: 1,
          note: 'current inspection projection',
          order_item_id: orderItemId,
          received_qty: 2,
          restock_qty: 0,
          return_to_customer_qty: 1,
          scrap_qty: 0,
        }],
        resolution: 'CONTINUE_REFUND',
        resolution_note: 'continue with inspected quantity',
        resolved_at: NOW,
        status: 'ABNORMAL',
      },
      status: 'REFUNDING_AFTER_RETURN',
      type: 'RETURN_REFUND',
      version: 5,
    });
    const events: string[] = [];
    const transaction = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('FROM public.account')) return [{
          deleted_at: null, has_password: true, id: actorAccountId, role: 'SUPER_ADMIN', status: 'ACTIVE',
        }];
        if (text.includes('FROM public.sales_order')) { events.push('order'); return [{ id: orderId }]; }
        if (text.includes('FROM public.order_item')) { events.push('order-items'); return [{ id: orderItemId }]; }
        if (text.includes('FROM public.aftersale_item')) {
          events.push('aftersale-items'); return [{ id: aftersaleItemId }];
        }
        if (text.includes('FROM public.aftersale')) { events.push('aftersales'); return [{ id: aftersaleId }]; }
        throw new Error(`Unexpected SQL: ${text}`);
      }),
      aftersale: {
        findUnique: vi.fn(async (args: { include?: unknown }) =>
          args.include ? record : { order_id: orderId, type: 'RETURN_REFUND' }),
      },
    };
    const repository = new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 5));

    const replay = await repository.getForReplayInTransaction(
      transaction as unknown as DatabaseTransaction,
      { actorAccountId, aftersaleId },
    );

    expect(replay).toMatchObject({
      inspection: {
        abnormalReason: 'fixture mismatch',
        evidenceFileIds: [inspectionEvidenceId],
        inspectedBy: { accountId: actorAccountId, displayName: '总部管理员' },
        inspectionId,
        items: [{
          approvedRefundQuantity: 1,
          note: 'current inspection projection',
          orderItemId,
          returnToCustomerQuantity: 1,
        }],
        resolution: 'CONTINUE_REFUND',
        result: 'ABNORMAL',
      },
      items: [{ approvedRefundQuantity: 1 }],
      status: 'REFUNDING_AFTER_RETURN',
      version: 5,
    });
    expect(events).toEqual(['order', 'order-items', 'aftersales', 'aftersale-items']);
  });

  it('approves refund-only after taking actor, Order and stable child locks and increments both versions', async () => {
    const state = approveHarness();
    const result = await state.repository.approveInTransaction(state.transaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
      note: ' x ',
    }, { protectReturnAddress: vi.fn() });

    expect(result).toMatchObject({
      aftersale: { status: 'REFUNDING', version: 2 },
      audit: {
        after: { status: 'REFUNDING', version: 2 },
        before: { status: 'PENDING_REVIEW', version: 1 },
      },
    });
    expect(state.events).toEqual([
      'lock:actor',
      'lock:order',
      'lock:order-items',
      'lock:aftersales',
      'lock:aftersale-items',
      'write:aftersale',
      'write:order',
    ]);
    expect(state.transactionStub.aftersale.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ review_reason: 'x' }),
    }));
  });

  it('locks the published address and creates a freshly protected snapshot for return approval', async () => {
    const state = approveHarness('RETURN_REFUND');
    const protectReturnAddress = vi.fn<AdminAftersaleApproveHooks['protectReturnAddress']>(async ({ source }) => ({
      detailCiphertext: Buffer.from('snapshot-detail'),
      encryptionKeyId: 'snapshot-key',
      phoneCiphertext: Buffer.from('snapshot-phone'),
      phoneLast4: source.phoneLast4,
    }));

    const result = await state.repository.approveInTransaction(state.transaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
    }, { protectReturnAddress });

    expect(result.aftersale).toMatchObject({ status: 'WAITING_RETURN', version: 2 });
    expect(protectReturnAddress).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: expect.any(String),
      source: expect.objectContaining({ phoneLast4: '+ -1', sourceVersionId, sourceVersionNo: 3 }),
    }));
    expect(state.transactionStub.returnAddressSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        encryption_key_id: 'snapshot-key',
        phone_last4: '+ -1',
        source_version_id: sourceVersionId,
      }),
    }));
    expect(state.events.indexOf('lock:return-address')).toBeGreaterThan(state.events.indexOf('lock:aftersale-items'));
    expect(state.events.indexOf('write:return-address-snapshot')).toBeGreaterThan(
      state.events.indexOf('lock:return-address'),
    );
  });

  it('fails return approval with the registered 422 before invoking snapshot protection', async () => {
    const state = approveHarness('RETURN_REFUND');
    state.setPublishedAddressAvailable(false);
    const protectReturnAddress = vi.fn();

    await expect(state.repository.approveInTransaction(state.transaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
    }, { protectReturnAddress })).rejects.toMatchObject({ code: 'RETURN_ADDRESS_NOT_CONFIGURED' });
    expect(protectReturnAddress).not.toHaveBeenCalled();
    expect(state.transactionStub.aftersale.updateMany).not.toHaveBeenCalled();
  });

  it('rejects with exact quota release and stops on a competing quota CAS', async () => {
    const events: string[] = [];
    let failQuotaCas = false;
    let status = 'PENDING_REVIEW';
    let version = 1;
    let orderVersion = 7;
    const command = () => detailRecord({ status, version });
    const current = () => ({
      id: aftersaleId,
      items: [{
        id: aftersaleItemId,
        order_item_id: orderItemId,
        refunded_amount: new Prisma.Decimal('0.00'),
        refunded_qty: 0,
        reserved_amount: new Prisma.Decimal('25.00'),
        reserved_qty: 2,
      }],
      order_id: orderId,
      refunds: [],
      return_inspection: null,
      return_shipment: null,
      reviewed_at: null,
      status,
      type: 'REFUND_ONLY',
      version,
    });
    const transaction = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('FROM public.account')) return [{
          deleted_at: null, has_password: true, id: actorAccountId, role: 'SUPER_ADMIN', status: 'ACTIVE',
        }];
        if (text.includes('FROM public.sales_order')) { events.push('lock:order'); return [{ id: orderId }]; }
        if (text.includes('FROM public.order_item')) { events.push('lock:order-items'); return [{ id: orderItemId }]; }
        if (text.includes('FROM public.aftersale_item')) {
          events.push('lock:aftersale-items'); return [{ id: aftersaleItemId }];
        }
        if (text.includes('FROM public.aftersale')) { events.push('lock:aftersales'); return [{ id: aftersaleId }]; }
        if (text.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
        throw new Error(`Unexpected SQL: ${text}`);
      }),
      aftersale: {
        findUnique: vi.fn(async (args: { include?: unknown; select?: Record<string, unknown> }) => {
          if (args.include) return command();
          if (args.select && Object.keys(args.select).length === 2 &&
            args.select.order_id === true && args.select.type === true) {
            return { order_id: orderId, type: 'REFUND_ONLY' };
          }
          return current();
        }),
        updateMany: vi.fn(async () => {
          status = 'REJECTED';
          version += 1;
          return { count: 1 };
        }),
      },
      orderItem: {
        findMany: vi.fn(async () => [{
          aftersale_reserved_amount: new Prisma.Decimal('25.00'),
          aftersale_reserved_qty: 2,
          id: orderItemId,
          version: 4,
        }]),
        updateMany: vi.fn(async () => failQuotaCas ? { count: 0 } : { count: 1 }),
      },
      salesOrder: {
        findUnique: vi.fn(async () => ({ version: orderVersion })),
        updateMany: vi.fn(async () => { orderVersion += 1; return { count: 1 }; }),
      },
    };
    const repository = new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 9));
    const verifyPreview = vi.fn();
    const result = await repository.rejectInTransaction(transaction as unknown as DatabaseTransaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
      reason: ' rejected after review ',
    }, { verifyPreview });
    expect(verifyPreview).toHaveBeenCalledWith(expect.objectContaining({
      releaseAmount: '25.00',
      releaseQuantity: 2,
      resourceVersion: 1,
    }));
    expect(result.aftersale).toMatchObject({ status: 'REJECTED', version: 2 });
    expect(events.indexOf('lock:aftersale-items')).toBeGreaterThan(events.indexOf('lock:aftersales'));

    failQuotaCas = true;
    status = 'PENDING_REVIEW';
    version = 1;
    await expect(repository.rejectInTransaction(transaction as unknown as DatabaseTransaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
      reason: 'rejected after review',
    }, { verifyPreview: vi.fn() })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(transaction.aftersale.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps reject reasons at the frozen two-character minimum', async () => {
    const repository = new AdminAftersaleRepository({} as PrismaClient, Buffer.alloc(32, 10));
    await expect(repository.rejectInTransaction({} as DatabaseTransaction, {
      actorAccountId,
      aftersaleId,
      expectedVersion: 1,
      reason: 'x',
    }, { verifyPreview: vi.fn() })).rejects.toThrow('2 to 500');
  });
});
