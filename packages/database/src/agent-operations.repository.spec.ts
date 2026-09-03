import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { AgentOperationsRepository } from './agent-operations.repository';

const NOW = new Date('2026-09-03T08:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const accountId = id(-20_000);
const agentId = id(-19_000);
const customerAccountId = id(-18_500);
const customerId = id(-18_000);
const bindingId = id(-17_000);
const orderId = id(-16_000);
const orderItemId = id(-15_000);
const productId = id(-14_000);
const skuId = id(-13_000);

function activeAgent() {
  return {
    account: { deleted_at: null, id: accountId, role: 'AGENT_ADMIN', status: 'ACTIVE' },
    account_id: accountId,
    deleted_at: null,
    id: agentId,
    status: 'ACTIVE',
    version: 3,
  };
}

function binding() {
  return {
    customer: {
      account: { deleted_at: null, id: customerAccountId, role: 'CUSTOMER', status: 'ACTIVE' },
      account_id: customerAccountId,
      anonymized_at: null,
      id: customerId,
      phone_verifications: [{ phone_last4: '4826' }],
      registered_at: new Date(NOW.getTime() - 100_000),
      version: 6,
    },
    id: bindingId,
    started_at: new Date(NOW.getTime() - 90_000),
  };
}

function item() {
  return {
    aftersale_reserved_qty: 0,
    id: orderItemId,
    line_paid_amount: new Prisma.Decimal('39.80'),
    product_id: productId,
    product_name_snapshot: 'Frozen Product',
    quantity: 2,
    refunded_qty: 0,
    shipped_qty: 0,
    sku_id: skuId,
    sku_name_snapshot: 'Frozen SKU',
    unit_price: new Prisma.Decimal('19.90'),
  };
}

function paidOrder() {
  return {
    attribution_snapshot: {
      agent_id_snapshot: agentId,
      binding_id_snapshot: bindingId,
      privacy_projection: {
        agent_id: agentId,
        anonymized_at: null,
        city: 'Auckland',
        customer_alias: 'customer_payment_snapshot',
        customer_id: customerId,
        nickname_masked: 'P**',
        phone_tail: '4826',
      },
    },
    close_reason: null,
    completion_reason: null,
    created_at: new Date(NOW.getTime() - 80_000),
    customer_id: customerId,
    final_agent_id: agentId,
    fulfillment_status: 'READY_TO_SHIP',
    id: orderId,
    items: [item()],
    order_no: `QX${orderId}`,
    order_status: 'PENDING_SHIPMENT',
    paid_amount: new Prisma.Decimal('39.80'),
    paid_at: new Date(NOW.getTime() - 70_000),
    payable_amount: new Prisma.Decimal('39.80'),
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    refunded_amount: new Prisma.Decimal('0.00'),
  };
}

function prismaWith(transaction: Record<string, unknown>): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
}

describe('AgentOperationsRepository', () => {
  it('paginates current active bindings first and aggregates only matching binding snapshots', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      customerAgentBinding: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [binding()]),
      },
      salesOrder: { findMany: vi.fn(async () => [paidOrder()]) },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).listCustomers({
      accountId,
      agentId,
      keyword: 'customer_payment',
      page: 1,
      pageSize: 20,
    });

    expect(result).toMatchObject({
      items: [{
        bindingId,
        city: 'Auckland',
        consumptionAmount: '39.80',
        consumptionCount: 1,
        customerAlias: 'customer_payment_snapshot',
        customerId,
        lastProductName: 'Frozen Product',
        nicknameMasked: 'P**',
        phoneTail: '4826',
      }],
      total: 1,
    });
    const bindingQuery = transaction.customerAgentBinding.findMany.mock.calls[0]?.[0];
    expect(bindingQuery).toMatchObject({ skip: 0, take: 20 });
    expect(bindingQuery.where.AND[0]).toMatchObject({ agent_id: agentId, ended_at: null });
    expect(bindingQuery.select.customer.select).not.toHaveProperty('nickname');
    expect(JSON.stringify(bindingQuery.where)).not.toContain('"nickname":');
    expect(JSON.stringify(bindingQuery.where)).toContain('"nickname_masked"');
    const orderQuery = transaction.salesOrder.findMany.mock.calls[0]?.[0];
    expect(orderQuery.where).toMatchObject({
      attribution_snapshot: {
        is: { agent_id_snapshot: agentId, binding_id_snapshot: { in: [bindingId] } },
      },
      final_agent_id: agentId,
      payment_status: 'PAID',
    });
  });

  it('returns tenant-safe 404 before querying orders when customer_id is not currently bound', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      customerAgentBinding: { findFirst: vi.fn(async () => null) },
      salesOrder: { count: vi.fn(), findMany: vi.fn() },
    };
    await expect(new AgentOperationsRepository(prismaWith(transaction)).listOrders({
      accountId,
      agentId,
      customerId,
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(transaction.customerAgentBinding.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ customer_id: customerId }),
    }));
    expect(transaction.salesOrder.findMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.count).not.toHaveBeenCalled();
  });

  it('applies tenant, current binding, paid, aftersale and amount filters before count and pagination', async () => {
    const listRecord = { ...paidOrder(), _count: { aftersales: 0 }, aftersales: [] };
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      customerAgentBinding: { findFirst: vi.fn(async () => binding()) },
      salesOrder: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [listRecord]),
      },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).listOrders({
      accountId,
      agentId,
      customerId,
      hasAftersale: false,
      minAmount: '10.00',
      page: 2,
      pageSize: 10,
      sort: 'PAID_DESC',
    });

    expect(result.items[0]).toMatchObject({
      customerAlias: 'customer_payment_snapshot',
      customerCity: 'Auckland',
      finalAgentId: agentId,
      paymentStatus: 'PAID',
    });
    const listQuery = transaction.salesOrder.findMany.mock.calls[0]?.[0];
    const countQuery = transaction.salesOrder.count.mock.calls[0]?.[0];
    expect(listQuery).toMatchObject({ skip: 10, take: 10 });
    expect(listQuery.where).toEqual(countQuery.where);
    expect(listQuery.where).toMatchObject({
      aftersales: { none: {} },
      attribution_snapshot: { is: { agent_id_snapshot: agentId, binding_id_snapshot: bindingId } },
      customer_id: customerId,
      final_agent_id: agentId,
      payable_amount: { gte: expect.any(Prisma.Decimal) },
      payment_status: 'PAID',
    });
  });

  it('reads historical order identity only from payment projection and selects no address PII', async () => {
    const detail = {
      ...paidOrder(),
      address_snapshot: { city: 'Auckland', province: 'Auckland' },
      aftersales: [],
      items: [{
        ...item(),
        commission_snapshot: {
          agent_id: agentId,
          effective_rate: new Prisma.Decimal('5.0000'),
          original_commission: new Prisma.Decimal('1.99'),
          position: { state: 'EXPECTED' },
          source_type: 'PLATFORM',
        },
      }],
      refunds: [],
      shipment: null,
    };
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      salesOrder: { findFirst: vi.fn(async () => detail) },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).getOrder({
      accountId,
      agentId,
      orderId,
    });

    expect(result).toMatchObject({
      addressSummaryMasked: 'Auckland',
      customerAlias: 'customer_payment_snapshot',
      customerNicknameMasked: 'P**',
      customerPhoneTail: '4826',
      finalAgentId: agentId,
    });
    const query = transaction.salesOrder.findFirst.mock.calls[0]?.[0];
    expect(query.where).toMatchObject({
      attribution_snapshot: { is: { agent_id_snapshot: agentId } },
      final_agent_id: agentId,
      id: orderId,
      payment_status: 'PAID',
    });
    expect(query.select.address_snapshot.select).toEqual({ city: true, province: true });
    expect(query.select).not.toHaveProperty('customer');
  });
});
