import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { FulfillmentRepository } from './fulfillment.repository';

const NOW = new Date('2026-08-31T08:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const orderId = id(-20_000);
const customerId = id(-19_000);
const agentId = id(-18_000);
const addressSnapshotId = id(-17_000);
const orderItemId = id(-16_000);
const productId = id(-15_000);
const categoryId = id(-14_000);
const skuId = id(-13_000);
const shipmentId = id(-12_000);
const shipmentItemId = id(-11_000);
const eventId = id(-10_000);
const paymentIntentId = id(-9_000);
const paymentAttemptId = id(-8_000);
const refundId = id(-7_000);
const refundAttemptId = id(-6_000);
const aftersaleId = id(-5_000);
const commissionSnapshotId = id(-4_000);
const reservationId = id(-3_000);
const missingOrderId = id(-2_500);

function orderScalars(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_expires_at: null,
    business_rule_version_id: null,
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    created_at: new Date(NOW.getTime() - 30_000),
    customer_id: customerId,
    final_agent_id: agentId,
    final_channel: 'AGENT',
    fulfillment_status: 'SHIPPED',
    goods_amount: new Prisma.Decimal('39.80'),
    id: orderId,
    order_no: `QX${orderId}`,
    order_status: 'SHIPPING',
    paid_amount: new Prisma.Decimal('39.80'),
    paid_at: new Date(NOW.getTime() - 20_000),
    pay_expires_at: new Date(NOW.getTime() - 10_000),
    payable_amount: new Prisma.Decimal('39.80'),
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    refunded_amount: new Prisma.Decimal('0.00'),
    shipping_amount: new Prisma.Decimal('0.00'),
    source: 'CART',
    updated_at: NOW,
    version: 4,
    ...overrides,
  };
}

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_reserved_amount: new Prisma.Decimal('0.00'),
    aftersale_reserved_qty: 0,
    brand_name_snapshot: 'Fulfillment Brand',
    category_id: categoryId,
    category_name_snapshot: 'Fulfillment Category',
    created_at: new Date(NOW.getTime() - 29_000),
    id: orderItemId,
    line_paid_amount: new Prisma.Decimal('39.80'),
    pre_shipment_refunded_qty: 0,
    product_id: productId,
    product_name_snapshot: 'Fulfillment Product',
    quantity: 2,
    refunded_amount: new Prisma.Decimal('0.00'),
    refunded_qty: 0,
    shipped_qty: 2,
    sku_code_snapshot: 'FULFILLMENT-SKU',
    sku_id: skuId,
    sku_name_snapshot: 'Fulfillment SKU',
    unit_price: new Prisma.Decimal('19.90'),
    version: 2,
    ...overrides,
  };
}

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    carrier_code: 'MANUAL',
    carrier_name: 'Development Carrier',
    created_at: new Date(NOW.getTime() - 8_000),
    delivered_at: null,
    events: [{
      actor_account_id: id(-2_000),
      carrier_code: null,
      carrier_name: null,
      created_at: new Date(NOW.getTime() - 7_000),
      description: 'Shipment created',
      event_key: 'event-key-1',
      event_type: 'STATUS',
      id: eventId,
      location: null,
      occurred_at: new Date(NOW.getTime() - 7_000),
      reason: null,
      shipment_id: shipmentId,
      source: 'MANUAL',
      status_code: 'SHIPPED',
      tracking_no: null,
    }],
    id: shipmentId,
    items: [{
      created_at: new Date(NOW.getTime() - 8_000),
      id: shipmentItemId,
      order_item: {
        id: orderItemId,
        order_id: orderId,
        product_name_snapshot: 'Fulfillment Product',
        sku_id: skuId,
        sku_name_snapshot: 'Fulfillment SKU',
      },
      order_item_id: orderItemId,
      quantity: 2,
      shipment_id: shipmentId,
    }],
    order_id: orderId,
    shipped_at: new Date(NOW.getTime() - 8_000),
    status: 'SHIPPED',
    tracking_no: 'TRACK-REDACTED-1',
    updated_at: new Date(NOW.getTime() - 7_000),
    version: 1,
    ...overrides,
  };
}

function listRecord() {
  return {
    ...orderScalars(),
    address_snapshot: { phone_last4: '4826' },
    attribution_snapshot: { privacy_projection: { customer_alias: 'Customer Alias' } },
    final_agent: { id: agentId, name: 'Development Agent' },
  };
}

function detailRecord() {
  return {
    ...orderScalars(),
    address_snapshot: {
      city: 'Auckland',
      district: 'Central',
      id: addressSnapshotId,
      phone_last4: '4826',
      province: 'Auckland',
      recipient_name: 'Test Recipient',
    },
    aftersales: [{
      aftersale_no: `AS${aftersaleId}`,
      created_at: new Date(NOW.getTime() - 6_000),
      id: aftersaleId,
      items: [{ requested_amount: new Prisma.Decimal('1.00') }],
      status: 'COMPLETED',
      type: 'REFUND_ONLY',
      version: 2,
    }],
    attribution_snapshot: {
      captured_at: new Date(NOW.getTime() - 18_000),
      final_channel: 'AGENT',
      privacy_projection: {
        customer_alias: 'Customer Alias',
        nickname_masked: 'T**',
        phone_tail: '4826',
      },
    },
    customer: { id: customerId, nickname: 'Test Customer' },
    final_agent: { id: agentId, name: 'Development Agent' },
    inventory_reservation: { id: reservationId },
    items: [{
      ...orderItem(),
      commission_snapshot: {
        id: commissionSnapshotId,
        original_commission: new Prisma.Decimal('3.98'),
        position: {
          expected_remaining: new Prisma.Decimal('3.98'),
          reversed_total: new Prisma.Decimal('0.00'),
          state: 'EXPECTED',
        },
      },
    }],
    payment_intents: [{
      attempts: [{
        amount: new Prisma.Decimal('39.80'),
        failure_code: null,
        finished_at: new Date(NOW.getTime() - 19_000),
        id: paymentAttemptId,
        initiated_at: new Date(NOW.getTime() - 19_000),
        provider_transaction_id: 'provider-transaction-sensitive-4826',
        status: 'SUCCEEDED',
      }],
      id: paymentIntentId,
      intent_no: `PI${paymentIntentId}`,
      status: 'SUCCEEDED',
    }],
    refunds: [{
      amount: new Prisma.Decimal('1.00'),
      attempts: [{
        attempt_no: 1,
        failure_code: null,
        finished_at: new Date(NOW.getTime() - 4_000),
        id: refundAttemptId,
        requested_at: new Date(NOW.getTime() - 4_000),
        status: 'SUCCEEDED',
      }],
      id: refundId,
      origin_type: 'AFTERSALE',
      refund_no: `RF${refundId}`,
      status: 'SUCCEEDED',
    }],
    shipment: shipment(),
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn(async () => [{ id: orderId }]),
    inventoryLedger: {
      findMany: vi.fn(async () => [{
        ledger_type: 'ORDER_RESERVE',
        locked_change: 2,
        physical_change: 0,
        sku_id: skuId,
      }, {
        ledger_type: 'ORDER_PAID_DEDUCT',
        locked_change: -2,
        physical_change: -2,
        sku_id: skuId,
      }]),
    },
    salesOrder: {
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    ...overrides,
  } as unknown as DatabaseTransaction;
}

describe('FulfillmentRepository', () => {
  it('applies every Admin filter and uses a deterministic list tie-breaker without returning address PII', async () => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findMany).mockResolvedValueOnce([listRecord()] as never);
    const repository = new FulfillmentRepository({} as PrismaClient);
    const createdAtFrom = new Date(NOW.getTime() - 60_000);
    const createdAtToExclusive = new Date(NOW.getTime() + 1);

    const result = await repository.listAdminOrdersInTransaction(tx, {
      agentId,
      createdAtFrom,
      createdAtToExclusive,
      customerId,
      fulfillmentStatus: 'SHIPPED',
      maxAmount: '50.00',
      minAmount: '10.00',
      orderNo: `QX${orderId}`,
      orderStatus: 'SHIPPING',
      page: 2,
      pageSize: 20,
      paymentStatus: 'PAID',
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'NONE',
      sort: 'PAID_DESC',
    });

    expect(tx.salesOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ paid_at: { nulls: 'last', sort: 'desc' } }, { id: 'desc' }],
      skip: 20,
      take: 20,
      where: expect.objectContaining({
        final_agent_id: agentId,
        customer_id: customerId,
        created_at: { gte: createdAtFrom, lt: createdAtToExclusive },
        fulfillment_status: 'SHIPPED',
        order_no: `QX${orderId}`,
        order_status: 'SHIPPING',
        payment_status: 'PAID',
        refund_processing_status: 'IDLE',
        refund_progress_status: 'NONE',
      }),
    }));
    expect(result).toEqual({
      items: [expect.objectContaining({
        customerAlias: 'Customer Alias',
        paymentResolution: 'NORMAL',
        recipientPhoneMasked: '*** **** 4826',
      })],
      total: 1,
    });
    expect(JSON.stringify(result)).not.toContain('phone_ciphertext');
    expect(JSON.stringify(result)).not.toContain('detail_ciphertext');
  });

  it('returns a complete Admin read projection while the ordinary detail query never selects encrypted PII', async () => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce(detailRecord() as never);
    const repository = new FulfillmentRepository({} as PrismaClient);

    const result = await repository.getAdminOrderDetailInTransaction(tx, { orderId });

    const query = vi.mocked(tx.salesOrder.findUnique).mock.calls[0]![0] as {
      include: { address_snapshot: { select: Record<string, boolean> } };
    };
    expect(query.include.address_snapshot.select).not.toHaveProperty('phone_ciphertext');
    expect(query.include.address_snapshot.select).not.toHaveProperty('detail_ciphertext');
    expect(result.addressMasked).toEqual({
      detailMasked: '***',
      phoneMasked: '*** **** 4826',
      recipientNameMasked: 'T**',
      regionSummary: 'Auckland Auckland Central',
    });
    expect(result.eligibility).toMatchObject({
      activeAftersaleCount: 0,
      canAddLogisticsEvent: true,
      canComplete: true,
      canReadFulfillmentAddress: true,
      canShip: false,
    });
    expect(result.shipment?.events.map(({ eventId: current }) => current)).toEqual([eventId]);
    expect(result.paymentAttempts[0]?.providerTransactionIdMasked).toBe('prov****4826');
    expect(result.inventoryImpact).toEqual([{
      availableChange: -2,
      onHandChange: -2,
      reasons: ['ORDER_RESERVE', 'ORDER_PAID_DEDUCT'],
      reservedChange: 0,
      skuId,
    }]);
    expect(result.commissionImpact[0]).toMatchObject({
      commissionSnapshotId,
      latestState: 'EXPECTED',
      originalCommission: '3.98',
    });
    expect(JSON.stringify(result)).not.toContain('provider-transaction-sensitive-4826');
  });

  it.each([
    ['unpaid payment axis', { payment_status: 'PROCESSING' }],
    ['unresolved payment resolution', { payment_resolution: 'MANUAL_REQUIRED' }],
    ['shipment and fulfillment drift', { fulfillment_status: 'IN_TRANSIT' }],
  ])('hides ADD_LOGISTICS_EVENT eligibility for %s', async (_label, override) => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce({
      ...detailRecord(),
      ...override,
    } as never);

    const result = await new FulfillmentRepository({} as PrismaClient)
      .getAdminOrderDetailInTransaction(tx, { orderId });

    expect(result.eligibility.canAddLogisticsEvent).toBe(false);
  });

  it.each([
    ['active payment intent', {
      payment_intents: [{
        ...detailRecord().payment_intents[0],
        attempts: [{ ...detailRecord().payment_intents[0]!.attempts[0], finished_at: null, status: 'INITIATED' }],
        status: 'OPEN',
      }],
    }],
    ['active refund', {
      refund_processing_status: 'REFUNDING',
      refunds: [{ ...detailRecord().refunds[0], status: 'PROCESSING' }],
    }],
  ])('fails closed for Admin completion projection with %s', async (_label, override) => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce({ ...detailRecord(), ...override } as never);

    const result = await new FulfillmentRepository({} as PrismaClient)
      .getAdminOrderDetailInTransaction(tx, { orderId });

    expect(result.eligibility).toMatchObject({ canComplete: false, hasUnresolvedPayment: true });
  });

  it('isolates complete address material behind its dedicated read and copies encrypted buffers', async () => {
    const phoneCiphertext = Buffer.from('phone-ciphertext-fixture');
    const detailCiphertext = Buffer.from('detail-ciphertext-fixture');
    const tx = transaction();
    const eligibleRecord = {
      address_snapshot: {
        city: 'Auckland',
        created_at: new Date(NOW.getTime() - 30_000),
        detail_ciphertext: detailCiphertext,
        district: 'Central',
        encryption_key_id: 'field-current',
        id: addressSnapshotId,
        phone_ciphertext: phoneCiphertext,
        phone_last4: '4826',
        province: 'Auckland',
        recipient_name: 'Test Recipient',
      },
      fulfillment_status: 'READY_TO_SHIP',
      id: orderId,
      order_no: `QX${orderId}`,
      order_status: 'PENDING_SHIPMENT',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      shipment: null,
    };
    vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce(eligibleRecord as never);
    const repository = new FulfillmentRepository({} as PrismaClient);

    const material = await repository.getAdminFulfillmentAddressMaterialInTransaction(tx, { orderId });

    expect(material).toMatchObject({
      eligibleForRead: true,
      encryptionKeyId: 'field-current',
      orderId,
      paymentResolution: 'NORMAL',
      paymentStatus: 'PAID',
      phoneLast4: '4826',
      snapshotId: addressSnapshotId,
    });
    expect(material.phoneCiphertext).not.toBe(phoneCiphertext);
    expect(material.detailCiphertext).not.toBe(detailCiphertext);
    expect(material.phoneCiphertext).toEqual(phoneCiphertext);
    expect(material.detailCiphertext).toEqual(detailCiphertext);
    const lockQuery = vi.mocked(tx.$queryRaw).mock.calls[0]![0] as { strings: readonly string[] };
    expect(lockQuery.strings.join(' ')).toContain('FROM public.sales_order');
    expect(lockQuery.strings.join(' ')).toContain('FOR UPDATE');
    expect(vi.mocked(tx.$queryRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tx.salesOrder.findUnique).mock.invocationCallOrder[0]!);

    vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce({
      ...eligibleRecord,
      fulfillment_status: 'DELIVERED',
      order_status: 'SHIPPING',
    } as never);
    await expect(repository.getAdminFulfillmentAddressMaterialInTransaction(tx, { orderId }))
      .resolves.toMatchObject({ eligibleForRead: false, fulfillmentStatus: 'DELIVERED' });

    for (const paymentFacts of [
      { payment_resolution: 'NORMAL', payment_status: 'PROCESSING' },
      { payment_resolution: 'MANUAL_REQUIRED', payment_status: 'PAID' },
    ] as const) {
      vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce({
        ...eligibleRecord,
        ...paymentFacts,
      } as never);
      await expect(repository.getAdminFulfillmentAddressMaterialInTransaction(tx, { orderId }))
        .resolves.toMatchObject({
          eligibleForRead: false,
          paymentResolution: paymentFacts.payment_resolution,
          paymentStatus: paymentFacts.payment_status,
        });
    }

    for (const brokenFulfillmentFacts of [
      {
        fulfillment_status: 'READY_TO_SHIP',
        order_status: 'PENDING_SHIPMENT',
        shipment: { status: 'SHIPPED' },
      },
      {
        fulfillment_status: 'SHIPPED',
        order_status: 'SHIPPING',
        shipment: null,
      },
      {
        fulfillment_status: 'IN_TRANSIT',
        order_status: 'SHIPPING',
        shipment: { status: 'SHIPPED' },
      },
    ] as const) {
      vi.mocked(tx.salesOrder.findUnique).mockResolvedValueOnce({
        ...eligibleRecord,
        ...brokenFulfillmentFacts,
      } as never);
      await expect(repository.getAdminFulfillmentAddressMaterialInTransaction(tx, { orderId }))
        .resolves.toMatchObject({ eligibleForRead: false });
    }
  });

  it('returns a neutral 404 before reading address material when the order lock target is absent', async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([] as never);
    const repository = new FulfillmentRepository({} as PrismaClient);

    await expect(repository.getAdminFulfillmentAddressMaterialInTransaction(tx, { orderId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(tx.salesOrder.findUnique).not.toHaveBeenCalled();
  });

  it('derives a stable non-reversible customer alias and fails closed without an alias key', async () => {
    const record = { ...listRecord(), attribution_snapshot: null };
    const keyedTx = transaction();
    vi.mocked(keyedTx.salesOrder.findMany).mockResolvedValueOnce([record] as never);
    const keyedRepository = new FulfillmentRepository({} as PrismaClient, Buffer.alloc(32, 7));

    const result = await keyedRepository.listAdminOrdersInTransaction(keyedTx, {
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    });

    const alias = result.items[0]?.customerAlias;
    expect(alias).toMatch(/^customer_[a-f0-9]{26}$/);
    expect(alias).not.toContain(customerId.toLowerCase());
    const repeatedTx = transaction();
    vi.mocked(repeatedTx.salesOrder.findMany).mockResolvedValueOnce([record] as never);
    const repeated = await keyedRepository.listAdminOrdersInTransaction(repeatedTx, {
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    });
    expect(repeated.items[0]?.customerAlias).toBe(alias);
    const unkeyedTx = transaction();
    vi.mocked(unkeyedTx.salesOrder.findMany).mockResolvedValueOnce([record] as never);
    await expect(new FulfillmentRepository({} as PrismaClient).listAdminOrdersInTransaction(unkeyedTx, {
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('scopes the Store projection by customer and derives current logistics and receipt eligibility', async () => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findFirst).mockResolvedValueOnce({
      aftersales: [{ id: aftersaleId, status: 'COMPLETED' }],
      customer_id: customerId,
      fulfillment_status: 'SHIPPED',
      id: orderId,
      order_status: 'SHIPPING',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      payment_intents: [{
        attempts: [{ status: 'SUCCEEDED' }],
        id: paymentIntentId,
        status: 'SUCCEEDED',
      }],
      refund_processing_status: 'IDLE',
      refunds: [{ id: refundId, status: 'SUCCEEDED' }],
      shipment: shipment(),
      version: 4,
    } as never);
    const repository = new FulfillmentRepository({} as PrismaClient);

    const result = await repository.getOwnedFulfillmentProjectionInTransaction(tx, { customerId, orderId });

    expect(tx.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { customer_id: customerId, id: orderId },
    }));
    expect(result).toMatchObject({
      canConfirmReceipt: true,
      canViewLogistics: true,
      customerId,
      orderId,
      version: 4,
    });
    expect(result.shipment?.items).toEqual([expect.objectContaining({ orderItemId, quantity: 2, skuId })]);
  });

  it('batch-loads Store fulfillment once, preserves requested key order and omits missing or cross-owner rows', async () => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findMany).mockResolvedValueOnce([{
      aftersales: [{ id: aftersaleId, status: 'COMPLETED' }],
      customer_id: customerId,
      fulfillment_status: 'SHIPPED',
      id: orderId,
      order_status: 'SHIPPING',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      payment_intents: [{
        attempts: [{ status: 'SUCCEEDED' }],
        id: paymentIntentId,
        status: 'SUCCEEDED',
      }],
      refund_processing_status: 'IDLE',
      refunds: [{ id: refundId, status: 'CANCELLED' }],
      shipment: shipment(),
      version: 4,
    }] as never);
    const repository = new FulfillmentRepository({} as PrismaClient);

    const result = await repository.listOwnedFulfillmentProjectionsInTransaction(tx, {
      customerId,
      orderIds: [missingOrderId, orderId],
    });

    expect(tx.salesOrder.findMany).toHaveBeenCalledTimes(1);
    expect(tx.salesOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ id: 'asc' }],
      where: { customer_id: customerId, id: { in: [missingOrderId, orderId] } },
    }));
    expect([...result.keys()]).toEqual([orderId]);
    expect(result.get(orderId)).toMatchObject({ canConfirmReceipt: true, canViewLogistics: true });
    expect(result.has(missingOrderId)).toBe(false);
  });

  it('fails closed for Store receipt eligibility while refund processing is unresolved', async () => {
    const tx = transaction();
    vi.mocked(tx.salesOrder.findFirst).mockResolvedValueOnce({
      aftersales: [],
      customer_id: customerId,
      fulfillment_status: 'SHIPPED',
      id: orderId,
      order_status: 'SHIPPING',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      payment_intents: [{
        attempts: [{ status: 'SUCCEEDED' }],
        id: paymentIntentId,
        status: 'SUCCEEDED',
      }],
      refund_processing_status: 'REFUNDING',
      refunds: [],
      shipment: shipment(),
      version: 4,
    } as never);

    await expect(new FulfillmentRepository({} as PrismaClient).getOwnedFulfillmentProjectionInTransaction(
      tx,
      { customerId, orderId },
    )).resolves.toMatchObject({ canConfirmReceipt: false });
  });

  it('accepts an empty Store fulfillment batch without querying and rejects duplicate IDs', async () => {
    const tx = transaction();
    const repository = new FulfillmentRepository({} as PrismaClient);

    await expect(repository.listOwnedFulfillmentProjectionsInTransaction(tx, {
      customerId,
      orderIds: [],
    })).resolves.toEqual(new Map());
    expect(tx.salesOrder.findMany).not.toHaveBeenCalled();
    await expect(repository.listOwnedFulfillmentProjectionsInTransaction(tx, {
      customerId,
      orderIds: [orderId, orderId],
    })).rejects.toThrow('must be unique');
    expect(tx.salesOrder.findMany).not.toHaveBeenCalled();
  });

  it('returns the same neutral 404 for a missing or cross-customer Store order', async () => {
    const tx = transaction();
    const repository = new FulfillmentRepository({} as PrismaClient);

    await expect(repository.getOwnedFulfillmentProjectionInTransaction(tx, { customerId, orderId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('validates closed inputs before querying and wraps standalone reads in Repeatable Read', async () => {
    const tx = transaction();
    const transactionCall = vi.fn(async (
      operation: (current: DatabaseTransaction) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => {
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      return operation(tx);
    });
    const repository = new FulfillmentRepository({ $transaction: transactionCall } as unknown as PrismaClient);

    await expect(repository.listAdminOrders({
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    })).resolves.toEqual({ items: [], total: 1 });
    await expect(repository.listAdminOrdersInTransaction(tx, {
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
      unexpected: true,
    } as never)).rejects.toThrow('contains invalid fields');
    expect(transactionCall).toHaveBeenCalledTimes(1);
  });
});
