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
const categoryId = id(-12_000);
const commissionRuleId = id(-11_000);
const commissionSnapshotId = id(-10_000);
const commissionLedgerId = id(-8_000);
const walletId = id(-7_000);
const refundId = id(-6_000);

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
    category_id: categoryId,
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

function commissionLedgerFact() {
  return {
    agent_id: agentId,
    available_change: new Prisma.Decimal('0.00'),
    expected_change: new Prisma.Decimal('1.99'),
    frozen_change: new Prisma.Decimal('0.00'),
    id: commissionLedgerId,
    ledger_type: 'EXPECTED_CREATED',
    occurred_at: NOW,
    reason: 'ORDER_PAID',
    refund_id: null,
    snapshot_id: commissionSnapshotId,
    withdrawal_id: null,
  };
}

function commissionSnapshot() {
  return {
    agent_id: agentId,
    category_id_snapshot: categoryId,
    category_name_snapshot: 'Frozen Category',
    commission_base: new Prisma.Decimal('39.80'),
    created_at: new Date(NOW.getTime() - 60_000),
    effective_rate: new Prisma.Decimal('5.0000'),
    id: commissionSnapshotId,
    ledger: [commissionLedgerFact()],
    order_item: {
      category_id: categoryId,
      id: orderItemId,
      order: {
        attribution_snapshot: { agent_id_snapshot: agentId },
        final_agent_id: agentId,
        final_channel: 'AGENT',
        id: orderId,
        order_no: `QX${orderId}`,
        paid_at: new Date(NOW.getTime() - 70_000),
        payment_status: 'PAID',
      },
      product_id: productId,
      product_name_snapshot: 'Frozen Product',
      sku_id: skuId,
      sku_name_snapshot: 'Frozen SKU',
    },
    original_commission: new Prisma.Decimal('1.99'),
    position: {
      expected_remaining: new Prisma.Decimal('1.99'),
      id: id(-8_500),
      original_commission: new Prisma.Decimal('1.99'),
      reversed_total: new Prisma.Decimal('0.00'),
      snapshot_id: commissionSnapshotId,
      state: 'EXPECTED',
      version: 2,
    },
    product_id_snapshot: productId,
    rule_version: {
      effective_at: new Date(NOW.getTime() - 80_000),
      entries: [{
        configured_rate: new Prisma.Decimal('5.0000'),
        id: id(-9_000),
        rule_version_id: commissionRuleId,
        target_id: null,
        target_key: 'PLATFORM',
        target_type: 'PLATFORM',
      }],
      id: commissionRuleId,
      status: 'PUBLISHED',
      version_no: 3,
    },
    rule_version_id: commissionRuleId,
    sku_id_snapshot: skuId,
    source_type: 'PLATFORM',
  };
}

function commissionLedger(snapshot = commissionSnapshot()) {
  return {
    ...commissionLedgerFact(),
    snapshot,
  };
}

function prismaWith(transaction: Record<string, unknown>): PrismaClient {
  const current = {
    orderItemCommissionSnapshot: { findMany: vi.fn(async () => []) },
    ...transaction,
  };
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(current)),
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
        commission_snapshot: commissionSnapshot(),
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
      commissionItems: [{ commissionSnapshotId }],
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

  it('filters commission rows by the authenticated Agent before count and pagination', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      commissionLedger: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [commissionLedger()]),
      },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).listCommissions({
      accountId,
      agentId,
      ledgerType: 'EXPECTED_CREATED',
      orderNo: `QX${orderId}`,
      page: 2,
      pageSize: 10,
      state: 'EXPECTED',
    });

    expect(result).toMatchObject({
      items: [{
        commissionBase: '39.80',
        commissionSnapshotId,
        effectiveRate: '5.0000',
        ledgerId: commissionLedgerId,
        orderId,
        originalCommission: '1.99',
        positionState: 'EXPECTED',
        productName: 'Frozen Product',
      }],
      total: 1,
    });
    const listQuery = transaction.commissionLedger.findMany.mock.calls[0]?.[0];
    const countQuery = transaction.commissionLedger.count.mock.calls[0]?.[0];
    expect(listQuery).toMatchObject({ skip: 10, take: 10 });
    expect(listQuery.where).toEqual(countQuery.where);
    expect(listQuery.where).toMatchObject({
      agent_id: agentId,
      ledger_type: 'EXPECTED_CREATED',
      snapshot: {
        is: {
          agent_id: agentId,
          order_item: {
            order: {
              attribution_snapshot: { is: { agent_id_snapshot: agentId } },
              final_agent_id: agentId,
              final_channel: 'AGENT',
              order_no: `QX${orderId}`,
              payment_status: 'PAID',
            },
          },
          position: { is: { state: 'EXPECTED' } },
        },
      },
      withdrawal_id: null,
    });
  });

  it('returns tenant-safe 404 for another Agent commission snapshot', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      orderItemCommissionSnapshot: { findFirst: vi.fn(async () => null) },
    };
    await expect(new AgentOperationsRepository(prismaWith(transaction)).getCommission({
      accountId,
      agentId,
      commissionSnapshotId,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(transaction.orderItemCommissionSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agent_id: agentId,
        id: commissionSnapshotId,
        order_item: {
          order: expect.objectContaining({
            attribution_snapshot: { is: { agent_id_snapshot: agentId } },
            final_agent_id: agentId,
          }),
        },
      }),
    }));
  });

  it('returns one immutable payment snapshot with its ordered commission ledger', async () => {
    const ledger = commissionLedger();
    delete (ledger as { snapshot?: unknown }).snapshot;
    const snapshot = commissionSnapshot();
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      orderItemCommissionSnapshot: {
        findFirst: vi.fn(async () => ({ ...snapshot, ledger: [ledger] })),
      },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).getCommission({
      accountId,
      agentId,
      commissionSnapshotId,
    });

    expect(result).toMatchObject({
      categoryId,
      commissionBase: '39.80',
      commissionSnapshotId,
      effectiveRate: '5.0000',
      expectedRemaining: '1.99',
      hitPath: [`RULE_VERSION:${commissionRuleId}`, 'PLATFORM'],
      ledger: [{
        expectedChange: '1.99',
        ledgerId: commissionLedgerId,
        ledgerType: 'EXPECTED_CREATED',
        refundId: null,
      }],
      orderId,
      originalCommission: '1.99',
      ruleVersionId: commissionRuleId,
      ruleVersionNo: 3,
    });
    expect(transaction.orderItemCommissionSnapshot.findFirst.mock.calls[0]?.[0].select.ledger)
      .toMatchObject({ orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }] });

    snapshot.rule_version.status = 'DRAFT';
    snapshot.rule_version.effective_at = null;
    await expect(new AgentOperationsRepository(prismaWith(transaction)).getCommission({
      accountId,
      agentId,
      commissionSnapshotId,
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('blocks withdrawal when the reconciled available balance is zero', async () => {
    const transaction = {
      $queryRaw: vi.fn(async () => [{
        id: commissionRuleId,
        minimum_withdrawal_amount: new Prisma.Decimal('100.00'),
      }]),
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      agentBankAccount: { count: vi.fn(async () => 1) },
      agentWallet: {
        findUnique: vi.fn(async () => ({
          agent_id: agentId,
          available_balance: new Prisma.Decimal('0.00'),
          frozen_balance: new Prisma.Decimal('0.00'),
          id: walletId,
          version: 1,
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('0.00'),
            expected_change: new Prisma.Decimal('0.00'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
      },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('0.00') } })),
      },
      withdrawal: { count: vi.fn(async () => 0) },
    };

    await expect(new AgentOperationsRepository(prismaWith(transaction)).getWallet({ accountId, agentId }))
      .resolves.toMatchObject({
        availableBalance: '0.00',
        blockedReason: 'WITHDRAWAL_MINIMUM_NOT_MET',
        withdrawalAllowed: false,
      });
  });

  it('allows withdrawal only with a current rule, active bank account and no in-flight request', async () => {
    const transaction = {
      $queryRaw: vi.fn(async () => [{
        id: commissionRuleId,
        minimum_withdrawal_amount: new Prisma.Decimal('100.00'),
      }]),
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      agentBankAccount: { count: vi.fn(async () => 1) },
      agentWallet: {
        findUnique: vi.fn(async () => ({
          agent_id: agentId,
          available_balance: new Prisma.Decimal('100.00'),
          frozen_balance: new Prisma.Decimal('0.00'),
          id: walletId,
          version: 2,
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('100.00'),
            expected_change: new Prisma.Decimal('0.00'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
      },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('0.00') } })),
      },
      withdrawal: { count: vi.fn(async () => 0) },
    };

    await expect(new AgentOperationsRepository(prismaWith(transaction)).getWallet({ accountId, agentId }))
      .resolves.toMatchObject({ blockedReason: null, withdrawalAllowed: true });
  });

  it('fails closed when the wallet cache does not reconcile with its ledgers', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      agentWallet: {
        findUnique: vi.fn(async () => ({
          agent_id: agentId,
          available_balance: new Prisma.Decimal('1.00'),
          frozen_balance: new Prisma.Decimal('0.00'),
          id: walletId,
          version: 2,
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('0.00'),
            expected_change: new Prisma.Decimal('1.99'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
      },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('1.99') } })),
      },
    };
    await expect(new AgentOperationsRepository(prismaWith(transaction)).getWallet({ accountId, agentId }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transaction.agentWallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { agent_id: agentId },
    }));
    expect(transaction.commissionLedger.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { agent_id: agentId },
    }));
    expect(transaction.orderItemCommissionPosition.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { snapshot: { agent_id: agentId } },
    }));
  });

  it('builds a seven-day dashboard by Asia/Shanghai payment and refund dates', async () => {
    const todayPayment = new Date('2026-09-02T16:30:00.000Z');
    const todayRefund = new Date('2026-09-03T07:00:00.000Z');
    const dashboardLedger = {
      ...commissionLedger(),
      occurred_at: new Date('2026-09-03T01:00:00.000Z'),
    };
    delete (dashboardLedger as { snapshot?: unknown }).snapshot;
    const transaction = {
      $queryRaw: vi.fn(async () => [{ transaction_time: NOW }]),
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      agentWallet: {
        findUnique: vi.fn(async () => ({
          agent_id: agentId,
          available_balance: new Prisma.Decimal('0.00'),
          frozen_balance: new Prisma.Decimal('0.00'),
          id: walletId,
          version: 1,
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('0.00'),
            expected_change: new Prisma.Decimal('1.99'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
        findMany: vi.fn(async () => [dashboardLedger]),
      },
      customerAgentBinding: { count: vi.fn(async () => 2) },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('1.99') } })),
      },
      refund: {
        findMany: vi.fn(async () => [{ amount: new Prisma.Decimal('5.00'), id: refundId, succeeded_at: todayRefund }]),
      },
      salesOrder: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [{ id: orderId, paid_amount: new Prisma.Decimal('20.00'), paid_at: todayPayment }]),
      },
      withdrawal: { count: vi.fn(async () => 1) },
    };
    const result = await new AgentOperationsRepository(prismaWith(transaction)).getDashboard({ accountId, agentId });

    expect(result).toMatchObject({
      agentId,
      asOf: NOW,
      attributedCustomerCount: 2,
      expectedCommission: '1.99',
      monthNetSalesAmount: '15.00',
      pendingWithdrawalCount: 1,
      todayNetSalesAmount: '15.00',
      todayPaidOrderCount: 1,
    });
    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-1)).toEqual({
      businessDate: '2026-09-03',
      commissionChange: '1.99',
      netSalesAmount: '15.00',
      paidOrderCount: 1,
    });
    const orderQuery = transaction.salesOrder.findMany.mock.calls[0]?.[0];
    expect(orderQuery.where).toMatchObject({
      attribution_snapshot: { is: { agent_id_snapshot: agentId } },
      final_agent_id: agentId,
      final_channel: 'AGENT',
      paid_at: { gte: new Date('2026-08-27T16:00:00.000Z'), lte: NOW },
      payment_status: 'PAID',
    });
    expect(transaction.refund.findMany.mock.calls[0]?.[0].where).toMatchObject({
      order: expect.objectContaining({ final_agent_id: agentId }),
      status: 'SUCCEEDED',
    });
    expect(transaction.salesOrder.count).toHaveBeenCalledWith({
      where: {
        attribution_candidate: { is: { candidate_agent_id: agentId, submit_channel: 'AGENT' } },
        paid_at: { not: null },
        payment_resolution: 'MANUAL_REQUIRED',
        payment_status: 'PAID',
      },
    });
  });
});
