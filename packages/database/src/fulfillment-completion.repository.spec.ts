import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  type CompleteFulfillmentOrderInput,
  FulfillmentRepository,
} from './fulfillment.repository';

const DATABASE_TIME = new Date('2026-08-31T12:00:00.000Z');
const id = (offset: number) => generateUlid(DATABASE_TIME.getTime() + offset);
const actorId = id(-20_000);
const accountId = id(-19_000);
const customerId = id(-18_000);
const orderId = id(-17_000);
const itemIds = [id(-16_000), id(-15_000)] as const;
const shipmentId = id(-14_000);
const ruleId = id(-13_000);
const agentId = id(-12_000);
const walletId = id(-11_000);
const snapshotIds = [id(-10_000), id(-9_000)] as const;
const positionIds = [id(-8_000), id(-7_000)] as const;
const paymentIntentId = id(-6_000);
const paymentAttemptId = id(-5_900);

function queryText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join(' ') ?? String(query);
}

function orderRecord(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_expires_at: null,
    business_rule_version_id: null,
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    customer_id: customerId,
    final_agent_id: agentId,
    final_channel: 'AGENT',
    fulfillment_status: 'SHIPPED',
    id: orderId,
    order_status: 'SHIPPING',
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    refund_processing_status: 'IDLE',
    version: 7,
    ...overrides,
  };
}

function shipmentRecord(overrides: Record<string, unknown> = {}) {
  return {
    delivered_at: null,
    id: shipmentId,
    shipped_at: new Date(DATABASE_TIME.getTime() - 60_000),
    status: 'SHIPPED',
    version: 3,
    ...overrides,
  };
}

function commissionRecords(options: { zeroExpected?: boolean } = {}) {
  const amount = options.zeroExpected === true ? '0.00' : '8.50';
  const original = options.zeroExpected === true ? '2.00' : '10.00';
  const reversed = options.zeroExpected === true ? '2.00' : '1.50';
  return [{
    agent_id: agentId,
    category_id_snapshot: id(-6_900),
    category_name_snapshot: 'Category',
    commission_base: new Prisma.Decimal('100.00'),
    created_at: DATABASE_TIME,
    effective_rate: new Prisma.Decimal('10.0000'),
    id: snapshotIds[0],
    order_item: { id: itemIds[0], order_id: orderId },
    order_item_id: itemIds[0],
    original_commission: new Prisma.Decimal(original),
    position: {
      available_at: null,
      expected_remaining: new Prisma.Decimal(amount),
      id: positionIds[0],
      original_commission: new Prisma.Decimal(original),
      reversed_total: new Prisma.Decimal(reversed),
      snapshot_id: snapshotIds[0],
      state: 'EXPECTED',
      updated_at: DATABASE_TIME,
      version: 2,
    },
    product_id_snapshot: id(-6_800),
    rule_version_id: id(-6_700),
    sku_id_snapshot: id(-6_600),
    source_type: 'PLATFORM',
  }, {
    agent_id: agentId,
    category_id_snapshot: id(-6_500),
    category_name_snapshot: 'Category',
    commission_base: new Prisma.Decimal('20.00'),
    created_at: DATABASE_TIME,
    effective_rate: new Prisma.Decimal('0.0000'),
    id: snapshotIds[1],
    order_item: { id: itemIds[1], order_id: orderId },
    order_item_id: itemIds[1],
    original_commission: new Prisma.Decimal('0.00'),
    position: {
      available_at: null,
      expected_remaining: new Prisma.Decimal('0.00'),
      id: positionIds[1],
      original_commission: new Prisma.Decimal('0.00'),
      reversed_total: new Prisma.Decimal('0.00'),
      snapshot_id: snapshotIds[1],
      state: 'NONE',
      updated_at: DATABASE_TIME,
      version: 1,
    },
    product_id_snapshot: id(-6_400),
    rule_version_id: id(-6_300),
    sku_id_snapshot: id(-6_200),
    source_type: 'PLATFORM',
  }];
}

interface HarnessOptions {
  account?: unknown;
  aftersales?: Array<{ id: string; status: string }>;
  commissions?: ReturnType<typeof commissionRecords>;
  order?: ReturnType<typeof orderRecord>;
  paymentAttempts?: Array<{ id: string; payment_intent_id: string; status: string }>;
  paymentIntents?: Array<{ id: string; status: string; succeeded_at: Date | null }>;
  refunds?: Array<{ id: string; status: string }>;
  rule?: { aftersale_window_days: number; effective_at: Date | null; id: string } | null;
  shipment?: ReturnType<typeof shipmentRecord>;
  wallet?: { agent_id: string; available_balance: Prisma.Decimal; frozen_balance: Prisma.Decimal; id: string; version: number } | null;
  walletUpdateCount?: number;
}

function transaction(options: HarnessOptions = {}) {
  const order = options.order ?? orderRecord();
  const shipment = options.shipment ?? shipmentRecord();
  const commissions = options.commissions ?? commissionRecords();
  const rule = options.rule === undefined
    ? { aftersale_window_days: 7, effective_at: new Date(DATABASE_TIME.getTime() - 60_000), id: ruleId }
    : options.rule;
  const wallet = options.wallet === undefined
    ? {
        agent_id: agentId,
        available_balance: new Prisma.Decimal('-1.00'),
        frozen_balance: new Prisma.Decimal('0.00'),
        id: walletId,
        version: 4,
      }
    : options.wallet;
  const account = options.account ?? {
    customer_profile: { account_id: accountId, anonymized_at: null, id: customerId },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'b113-open-id',
  };
  const actor = { deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' };
  const tx = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('transaction_timestamp()')) return [{ transaction_time: DATABASE_TIME }];
      if (sql.includes('FROM public.account')) return [actor];
      if (sql.includes('FROM public.sales_order')) return [{ id: orderId }];
      if (sql.includes('FROM public.payment_intent')) {
        return options.paymentIntents ?? [{ id: paymentIntentId, status: 'SUCCEEDED', succeeded_at: DATABASE_TIME }];
      }
      if (sql.includes('FROM public.payment_attempt')) {
        return options.paymentAttempts ?? [{
          id: paymentAttemptId,
          payment_intent_id: paymentIntentId,
          status: 'SUCCEEDED',
        }];
      }
      if (sql.includes('FROM public.refund')) return options.refunds ?? [];
      if (sql.includes('FROM public.aftersale')) return options.aftersales ?? [];
      if (sql.includes('FROM public.shipment')) return [{ id: shipmentId }];
      if (sql.includes('FROM public.business_rule_version')) return rule === null ? [] : [rule];
      if (sql.includes('FROM public.order_item_commission_position')) {
        return commissions.map(({ id: snapshotId, position }) => ({ id: position.id, snapshot_id: snapshotId }));
      }
      if (sql.includes('FROM public.agent_wallet')) return wallet === null ? [] : [wallet];
      if (sql.includes('FROM public.order_item')) return itemIds.map((itemId) => ({ id: itemId }));
      throw new Error(`Unexpected completion query: ${sql}`);
    }),
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    account: { findUnique: vi.fn(async () => account) },
    agentWallet: { updateMany: vi.fn(async () => ({ count: options.walletUpdateCount ?? 1 })) },
    commissionLedger: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
    },
    orderItemCommissionPosition: { updateMany: vi.fn(async () => ({ count: 1 })) },
    orderItemCommissionSnapshot: { findMany: vi.fn(async () => commissions) },
    salesOrder: {
      findUnique: vi.fn(async () => order),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    shipment: {
      findUnique: vi.fn(async () => shipment),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return tx as unknown as DatabaseTransaction;
}

function adminInput(overrides: Partial<CompleteFulfillmentOrderInput> = {}): CompleteFulfillmentOrderInput {
  return {
    actor: { actorAccountId: actorId, kind: 'ADMIN' },
    completionReason: 'ADMIN_FORCED',
    expectedOrderVersion: 7,
    orderId,
    ...overrides,
  };
}

function repository(): FulfillmentRepository {
  return new FulfillmentRepository({} as PrismaClient, undefined, () => new Date(0));
}

describe('FulfillmentRepository completion commands', () => {
  it('uses the frozen lock order, database time, remaining commission and one immutable credit', async () => {
    const tx = transaction();
    const result = await repository().completeOrderInTransaction(tx, adminInput());

    expect(result).toMatchObject({
      after: { fulfillmentStatus: 'DELIVERED', orderStatus: 'COMPLETED', orderVersion: 8, shipmentVersion: 4 },
      aftersaleExpiresAt: new Date('2026-09-07T12:00:00.000Z'),
      before: { fulfillmentStatus: 'SHIPPED', orderStatus: 'SHIPPING', orderVersion: 7, shipmentVersion: 3 },
      businessRuleVersionId: ruleId,
      completedAt: DATABASE_TIME,
      orderId,
      shipmentId,
    });
    expect(result.commissionCredits).toHaveLength(1);
    expect(result.commissionCredits[0]).toMatchObject({ version: 3 });

    const lockSql = vi.mocked(tx.$queryRaw).mock.calls.map(([query]) => queryText(query))
      .filter((sql) => sql.includes('FOR UPDATE'));
    expect(lockSql.map((sql) => {
      if (sql.includes('public.account')) return 'actor';
      if (sql.includes('public.sales_order')) return 'order';
      if (sql.includes('FROM public.order_item\n')) return 'items';
      if (sql.includes('public.payment_attempt')) return 'attempts';
      if (sql.includes('public.payment_intent')) return 'payment';
      if (sql.includes('public.refund')) return 'refunds';
      if (sql.includes('public.aftersale')) return 'aftersales';
      if (sql.includes('public.shipment')) return 'shipment';
      if (sql.includes('public.business_rule_version')) return 'rule';
      if (sql.includes('public.order_item_commission_position')) return 'positions';
      return 'wallets';
    })).toEqual([
      'actor', 'order', 'items', 'payment', 'attempts', 'refunds', 'aftersales', 'shipment', 'rule', 'positions',
      'wallets',
    ]);
    expect(lockSql.find((sql) => sql.includes('order_item_commission_snapshot')))
      .toContain('FOR UPDATE OF position');
    expect(lockSql.some((sql) => sql.includes('commission_ledger'))).toBe(false);

    expect(tx.orderItemCommissionPosition.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expected_remaining: new Prisma.Decimal(0), state: 'AVAILABLE' }),
      where: expect.objectContaining({ expected_remaining: new Prisma.Decimal('8.50'), version: 2 }),
    }));
    expect(tx.commissionLedger.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        available_change: new Prisma.Decimal('8.50'),
        expected_change: new Prisma.Decimal('-8.50'),
        ledger_type: 'AVAILABLE_CREDIT',
        reason: 'ORDER_COMPLETED',
      })],
      skipDuplicates: true,
    });
    expect(tx.agentWallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ available_balance: { increment: new Prisma.Decimal('8.50') } }),
      where: { id: walletId, version: 4 },
    }));
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ delivered_at: DATABASE_TIME, status: 'DELIVERED' }),
    }));
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aftersale_expires_at: new Date('2026-09-07T12:00:00.000Z'),
        completed_at: DATABASE_TIME,
        completion_reason: 'ADMIN_FORCED',
        order_status: 'COMPLETED',
      }),
    }));
  });

  it('reauthenticates a passwordless CUSTOMER replay and returns the current completed fact without If-Match', async () => {
    const completedAt = new Date(DATABASE_TIME.getTime() - 1_000);
    const tx = transaction({
      order: orderRecord({
        aftersale_expires_at: new Date(DATABASE_TIME.getTime() + 7 * 86_400_000),
        business_rule_version_id: ruleId,
        completed_at: completedAt,
        completion_reason: 'CUSTOMER_CONFIRMED',
        fulfillment_status: 'DELIVERED',
        order_status: 'COMPLETED',
        version: 9,
      }),
      shipment: shipmentRecord({ delivered_at: completedAt, status: 'DELIVERED', version: 4 }),
    });
    await expect(repository().getCompletedOrderForReplayInTransaction(tx, {
      actor: { accountId, customerId, kind: 'CUSTOMER' },
      completionReason: 'CUSTOMER_CONFIRMED',
      orderId,
    })).resolves.toMatchObject({
      completionReason: 'CUSTOMER_CONFIRMED', orderId, orderVersion: 9, shipmentStatus: 'DELIVERED',
    });
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      'store-auth-account',
      JSON.stringify([accountId]),
    );
    expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      'store-auth-customer',
      JSON.stringify([customerId]),
    );
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('fails before commission writes for an active refund, stale version, or missing frozen wallet', async () => {
    const activeRefund = transaction({ refunds: [{ id: id(-5_000), status: 'PROCESSING' }] });
    await expect(repository().completeOrderInTransaction(activeRefund, adminInput()))
      .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
    expect(activeRefund.orderItemCommissionPosition.updateMany).not.toHaveBeenCalled();

    const stale = transaction();
    await expect(repository().completeOrderInTransaction(stale, adminInput({ expectedOrderVersion: 6 })))
      .rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(stale.shipment.findUnique).not.toHaveBeenCalled();

    const missingWallet = transaction({ wallet: null });
    await expect(repository().completeOrderInTransaction(missingWallet, adminInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(missingWallet.orderItemCommissionPosition.updateMany).not.toHaveBeenCalled();
    expect(missingWallet.commissionLedger.createMany).not.toHaveBeenCalled();
    expect(missingWallet.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('blocks an active payment intent and rejects paid orders without exactly one successful intent', async () => {
    const active = transaction({
      paymentIntents: [
        { id: paymentIntentId, status: 'SUCCEEDED', succeeded_at: DATABASE_TIME },
        { id: id(-5_500), status: 'CLOSE_PENDING', succeeded_at: null },
      ],
    });
    await expect(repository().completeOrderInTransaction(active, adminInput()))
      .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
    expect(active.shipment.findUnique).not.toHaveBeenCalled();

    const missingSuccess = transaction({
      paymentIntents: [{ id: paymentIntentId, status: 'FAILED', succeeded_at: null }],
    });
    await expect(repository().completeOrderInTransaction(missingSuccess, adminInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(missingSuccess.orderItemCommissionPosition.updateMany).not.toHaveBeenCalled();

    const duplicateSuccess = transaction({
      paymentIntents: [
        { id: paymentIntentId, status: 'SUCCEEDED', succeeded_at: DATABASE_TIME },
        { id: id(-5_400), status: 'SUCCEEDED', succeeded_at: DATABASE_TIME },
      ],
    });
    await expect(repository().completeOrderInTransaction(duplicateSuccess, adminInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const lateAttempt = transaction({
      paymentAttempts: [{ id: paymentAttemptId, payment_intent_id: paymentIntentId, status: 'SUCCEEDED_LATE' }],
    });
    await expect(repository().completeOrderInTransaction(lateAttempt, adminInput()))
      .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
  });

  it('transitions an EXPECTED zero remainder without creating a zero ledger or touching a wallet', async () => {
    const tx = transaction({ commissions: commissionRecords({ zeroExpected: true }), wallet: null });
    await expect(repository().completeOrderInTransaction(tx, adminInput()))
      .resolves.toMatchObject({ commissionCredits: [] });
    expect(tx.orderItemCommissionPosition.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.commissionLedger.createMany).not.toHaveBeenCalled();
    expect(tx.agentWallet.updateMany).not.toHaveBeenCalled();
  });

  it('completes DIRECT and an already DELIVERED shipment without commission or a shipment rewrite', async () => {
    const tx = transaction({
      commissions: [],
      order: orderRecord({ final_agent_id: null, final_channel: 'DIRECT', fulfillment_status: 'DELIVERED' }),
      shipment: shipmentRecord({ delivered_at: DATABASE_TIME, status: 'DELIVERED' }),
      wallet: null,
    });
    await expect(repository().completeOrderInTransaction(tx, adminInput())).resolves.toMatchObject({
      after: { shipmentStatus: 'DELIVERED', shipmentVersion: 3 },
      commissionCredits: [],
    });
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
    expect(tx.orderItemCommissionPosition.updateMany).not.toHaveBeenCalled();
    expect(tx.commissionLedger.createMany).not.toHaveBeenCalled();
    expect(tx.agentWallet.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the locked wallet CAS does not apply', async () => {
    const tx = transaction({ walletUpdateCount: 0 });
    await expect(repository().completeOrderInTransaction(tx, adminInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects actor/reason mixing and unknown input fields before database access', async () => {
    const tx = transaction();
    await expect(repository().completeOrderInTransaction(tx, {
      ...adminInput(),
      completionReason: 'CUSTOMER_CONFIRMED',
    })).rejects.toBeInstanceOf(TypeError);
    await expect(repository().completeOrderInTransaction(tx, {
      ...adminInput(),
      unexpected: true,
    } as never)).rejects.toBeInstanceOf(TypeError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
