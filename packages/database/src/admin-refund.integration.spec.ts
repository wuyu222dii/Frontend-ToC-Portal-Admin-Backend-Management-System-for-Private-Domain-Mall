import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import {
  AdminRefundRepository,
  type AdminRefundProviderOperation,
} from './admin-refund.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B12_STORE_AFTERSALE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B12_STORE_AFTERSALE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const rollbackSentinel = Object.freeze({ code: 'B124_ADMIN_REFUND_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface Fixture {
  actorId: string;
  aftersaleId: string;
  aftersaleItemId: string;
  agentAccountId: string;
  agentId: string;
  balanceId: string;
  brandId: string;
  categoryId: string;
  commissionPositionId: string;
  commissionRuleVersionId: string;
  commissionSnapshotId: string;
  completionCommissionLedgerId: string;
  customerAccountId: string;
  customerId: string;
  orderId: string;
  orderItemId: string;
  paymentAttemptId: string;
  paymentIntentId: string;
  productId: string;
  skuId: string;
  walletId: string;
  zeroApprovedAftersaleItemId: string;
  zeroApprovedBalanceId: string;
  zeroApprovedCommissionPositionId: string;
  zeroApprovedCommissionSnapshotId: string;
  zeroApprovedOrderItemId: string;
  zeroApprovedSkuId: string;
}

/**
 * Every integration fixture is expected to live entirely inside the
 * transaction guarded by the rollback sentinel.  Keep the parent IDs so the
 * afterAll check can detect an accidental out-of-transaction write (for
 * example a refund attempt or ledger fact written through a fresh client).
 */
const registeredFixtures = new Map<string, Fixture>();

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B12.4 Admin refund database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B12.4 Admin refund tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new TypeError('Full B12.4 Admin refund tests require loopback PostgreSQL');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b124-admin-refund-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B12.4 Admin refund tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b124-admin-refund-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function fixture(now: Date): Fixture {
  const id = (offset: number) => generateUlid(now.getTime() - offset);
  const value: Fixture = {
    actorId: id(24_000),
    aftersaleId: id(8_000),
    aftersaleItemId: id(7_000),
    agentAccountId: id(23_000),
    agentId: id(22_000),
    balanceId: id(13_000),
    brandId: id(20_000),
    categoryId: id(19_000),
    commissionPositionId: id(4_000),
    commissionRuleVersionId: id(6_000),
    commissionSnapshotId: id(5_000),
    completionCommissionLedgerId: id(1_000),
    customerAccountId: id(18_000),
    customerId: id(17_000),
    orderId: id(11_000),
    orderItemId: id(10_000),
    paymentAttemptId: id(2_000),
    paymentIntentId: id(3_000),
    productId: id(16_000),
    skuId: id(14_000),
    walletId: id(21_000),
    zeroApprovedAftersaleItemId: id(7_500),
    zeroApprovedBalanceId: id(12_000),
    zeroApprovedCommissionPositionId: id(5_500),
    zeroApprovedCommissionSnapshotId: id(6_500),
    zeroApprovedOrderItemId: id(9_000),
    zeroApprovedSkuId: id(15_000),
  };
  registeredFixtures.set(value.orderId, value);
  return value;
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime): Promise<void> {
  const fixtures = [...registeredFixtures.values()];
  if (fixtures.length === 0) return;

  const ids = <K extends keyof Fixture>(key: K): string[] =>
    [...new Set(fixtures.map((value) => value[key]))];
  const orderIds = ids('orderId');
  const accountIds = [...new Set(fixtures.flatMap((value) => [value.actorId, value.agentAccountId,
    value.customerAccountId]))];
  const agentIds = ids('agentId');
  const customerIds = ids('customerId');
  const brandIds = ids('brandId');
  const categoryIds = ids('categoryId');
  const productIds = ids('productId');
  const skuIds = [...new Set(fixtures.flatMap((value) => [value.skuId, value.zeroApprovedSkuId]))];
  const orderItemIds = [...new Set(fixtures.flatMap((value) => [
    value.orderItemId,
    value.zeroApprovedOrderItemId,
  ]))];
  const paymentIntentIds = ids('paymentIntentId');
  const paymentAttemptIds = ids('paymentAttemptId');
  const commissionRuleVersionIds = ids('commissionRuleVersionId');
  const commissionSnapshotIds = [...new Set(fixtures.flatMap((value) => [
    value.commissionSnapshotId,
    value.zeroApprovedCommissionSnapshotId,
  ]))];
  const commissionPositionIds = [...new Set(fixtures.flatMap((value) => [
    value.commissionPositionId,
    value.zeroApprovedCommissionPositionId,
  ]))];
  const balanceIds = [...new Set(fixtures.flatMap((value) => [value.balanceId, value.zeroApprovedBalanceId]))];
  const walletIds = ids('walletId');
  const aftersaleIds = ids('aftersaleId');
  const aftersaleItemIds = [...new Set(fixtures.flatMap((value) => [
    value.aftersaleItemId,
    value.zeroApprovedAftersaleItemId,
  ]))];

  const counts = await Promise.all([
    runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
    runtime.prisma.customerProfile.count({ where: { id: { in: customerIds } } }),
    runtime.prisma.agentProfile.count({ where: { id: { in: agentIds } } }),
    runtime.prisma.agentWallet.count({ where: { id: { in: walletIds } } }),
    runtime.prisma.brand.count({ where: { id: { in: brandIds } } }),
    runtime.prisma.category.count({ where: { id: { in: categoryIds } } }),
    runtime.prisma.product.count({ where: { id: { in: productIds } } }),
    runtime.prisma.sku.count({ where: { id: { in: skuIds } } }),
    runtime.prisma.inventoryBalance.count({ where: { id: { in: balanceIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
    runtime.prisma.orderItem.count({ where: { id: { in: orderItemIds } } }),
    runtime.prisma.paymentIntent.count({ where: { id: { in: paymentIntentIds } } }),
    runtime.prisma.paymentAttempt.count({ where: { id: { in: paymentAttemptIds } } }),
    runtime.prisma.commissionRuleVersion.count({ where: { id: { in: commissionRuleVersionIds } } }),
    runtime.prisma.orderItemCommissionSnapshot.count({ where: { id: { in: commissionSnapshotIds } } }),
    runtime.prisma.orderItemCommissionPosition.count({ where: { id: { in: commissionPositionIds } } }),
    runtime.prisma.aftersale.count({ where: { id: { in: aftersaleIds } } }),
    runtime.prisma.aftersaleItem.count({ where: { id: { in: aftersaleItemIds } } }),
    // Child facts created by the repository are identified through their
    // stable order/aftersale/SKU/agent parents rather than generated IDs.
    runtime.prisma.refund.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.refundAttempt.count({ where: { refund: { order_id: { in: orderIds } } } }),
    runtime.prisma.refundItem.count({ where: { refund: { order_id: { in: orderIds } } } }),
    runtime.prisma.manualCompensation.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.inventoryLedger.count({ where: { sku_id: { in: skuIds } } }),
    runtime.prisma.commissionLedger.count({ where: { agent_id: { in: agentIds } } }),
  ]);
  if (counts.some((count) => count !== 0)) {
    throw new TypeError(`B12.4 Admin refund fixture residue after rollback: ${JSON.stringify(counts)}`);
  }
}

async function seedPaidRefundFixture(
  transaction: DatabaseTransaction,
  ids: Fixture,
  now: Date,
  input: {
    commissionState?: 'AVAILABLE' | 'EXPECTED';
    primaryQuantity?: number;
    withAftersale: boolean;
  },
): Promise<void> {
  const commissionState = input.commissionState ?? 'EXPECTED';
  const primaryQuantity = input.primaryQuantity ?? 2;
  const primaryAmount = new Prisma.Decimal(primaryQuantity).mul('10.00');
  const primaryCommission = primaryAmount.mul('0.10');
  await transaction.account.createMany({
    data: [{
      created_at: now,
      id: ids.actorId,
      login_name: `b124-admin-${ids.actorId}`,
      password_hash: 'b124-admin-password-hash',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
    }, {
      created_at: now,
      id: ids.agentAccountId,
      login_name: `b124-agent-${ids.agentAccountId}`,
      password_hash: 'b124-agent-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
    }, {
      created_at: now,
      id: ids.customerAccountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      wechat_open_id: `b124-customer-${ids.customerAccountId}`,
    }],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.customerAccountId,
      created_at: now,
      id: ids.customerId,
      registered_at: now,
      updated_at: now,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.agentAccountId,
      agent_no: `B124-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B12.4 Refund Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.agentWallet.create({
    data: {
      available_balance: commissionState === 'AVAILABLE' ? primaryCommission : new Prisma.Decimal('0.00'),
      agent_id: ids.agentId,
      frozen_balance: new Prisma.Decimal('0.00'),
      id: ids.walletId,
      updated_at: now,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: ids.brandId,
      name: `B124 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: ids.categoryId,
      name: `B124 Category ${ids.categoryId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: ids.brandId,
      category_id: ids.categoryId,
      created_at: now,
      id: ids.productId,
      name: `B124 Product ${ids.productId}`,
      published_at: now,
      sales_count: 2,
      spu_code: `B124-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B124-SKU-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B12.4 Refund SKU',
      product_id: ids.productId,
      retail_price: new Prisma.Decimal('10.00'),
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: ids.balanceId,
      locked_qty: 0,
      physical_qty: 3,
      sku_id: ids.skuId,
      updated_at: now,
    },
  });
  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: ids.customerId,
      final_agent_id: ids.agentId,
      final_channel: 'AGENT',
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: new Prisma.Decimal('20.00'),
      id: ids.orderId,
      order_no: `QX${ids.orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: new Prisma.Decimal('20.00'),
      paid_at: now,
      pay_expires_at: new Date(now.getTime() + 30 * 60_000),
      payable_amount: new Prisma.Decimal('20.00'),
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: new Prisma.Decimal('0.00'),
      shipping_amount: new Prisma.Decimal('0.00'),
      source: 'BUY_NOW',
      updated_at: now,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: input.withAftersale ? primaryAmount : new Prisma.Decimal('0.00'),
      aftersale_reserved_qty: input.withAftersale ? primaryQuantity : 0,
      brand_name_snapshot: `B124 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B124 Category ${ids.categoryId}`,
      created_at: now,
      id: ids.orderItemId,
      line_paid_amount: primaryAmount,
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: `B124 Product ${ids.productId}`,
      quantity: primaryQuantity,
      sku_code_snapshot: `B124-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B12.4 Refund SKU',
      unit_price: new Prisma.Decimal('10.00'),
    },
  });
  await transaction.paymentIntent.create({
    data: {
      amount: new Prisma.Decimal('20.00'),
      create_requested_at: now,
      created_at: now,
      expires_at: new Date(now.getTime() + 30 * 60_000),
      id: ids.paymentIntentId,
      intent_no: `PI${ids.paymentIntentId}`,
      opened_at: now,
      order_id: ids.orderId,
      provider: 'MOCK',
      provider_intent_id: `mock_intent_${ids.paymentIntentId}`,
      provider_state: 'SUCCEEDED',
      status: 'SUCCEEDED',
      succeeded_at: now,
      updated_at: now,
    },
  });
  await transaction.paymentAttempt.create({
    data: {
      amount: new Prisma.Decimal('20.00'),
      finished_at: now,
      id: ids.paymentAttemptId,
      initiated_at: now,
      payment_intent_id: ids.paymentIntentId,
      provider: 'MOCK',
      provider_transaction_id: `mock_transaction_${ids.paymentAttemptId}`,
      status: 'SUCCEEDED',
    },
  });
  const maximumRule = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
  await transaction.commissionRuleVersion.create({
    data: {
      created_at: now,
      created_by_id: ids.actorId,
      id: ids.commissionRuleVersionId,
      reason: 'B12.4 refund frozen commission fixture',
      status: 'DRAFT',
      version_no: (maximumRule._max.version_no ?? 0) + 1,
    },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: `B124 Category ${ids.categoryId}`,
      commission_base: primaryAmount,
      created_at: now,
      effective_rate: new Prisma.Decimal('10.0000'),
      id: ids.commissionSnapshotId,
      order_item_id: ids.orderItemId,
      original_commission: primaryCommission,
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleVersionId,
      sku_id_snapshot: ids.skuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      available_at: commissionState === 'AVAILABLE' ? now : null,
      expected_remaining: commissionState === 'AVAILABLE' ? new Prisma.Decimal('0.00') : primaryCommission,
      id: ids.commissionPositionId,
      original_commission: primaryCommission,
      reversed_total: new Prisma.Decimal('0.00'),
      snapshot_id: ids.commissionSnapshotId,
      state: commissionState,
      updated_at: now,
    },
  });
  if (commissionState === 'AVAILABLE') {
    await transaction.commissionLedger.create({
      data: {
        agent_id: ids.agentId,
        available_change: primaryCommission,
        expected_change: primaryCommission.negated(),
        frozen_change: new Prisma.Decimal('0.00'),
        id: ids.completionCommissionLedgerId,
        idempotency_key: `complete:${ids.orderId}:${ids.commissionSnapshotId}`,
        ledger_type: 'AVAILABLE_CREDIT',
        occurred_at: now,
        reason: 'ORDER_COMPLETED',
        snapshot_id: ids.commissionSnapshotId,
      },
    });
  }
  if (input.withAftersale) {
    await transaction.aftersale.create({
      data: {
        aftersale_no: `AS${ids.aftersaleId}`,
        created_at: now,
        customer_id: ids.customerId,
        id: ids.aftersaleId,
        order_id: ids.orderId,
        reason_code: 'QUALITY_ISSUE',
        reviewed_at: now,
        reviewed_by_id: ids.actorId,
        status: 'REFUNDING',
        type: 'REFUND_ONLY',
        updated_at: now,
      },
    });
    await transaction.aftersaleItem.create({
      data: {
        aftersale_id: ids.aftersaleId,
        created_at: now,
        id: ids.aftersaleItemId,
        order_item_id: ids.orderItemId,
        requested_amount: primaryAmount,
        requested_qty: primaryQuantity,
        reserved_amount: primaryAmount,
        reserved_qty: primaryQuantity,
      },
    });
  }
}

async function createAndClaimAftersaleRefund(
  transaction: DatabaseTransaction,
  repository: AdminRefundRepository,
  ids: Fixture,
  attemptKey: string,
): Promise<AdminRefundProviderOperation> {
  const preview = await repository.previewAftersaleRefundInTransaction(transaction, {
    actorAccountId: ids.actorId,
    aftersaleId: ids.aftersaleId,
    items: [{ aftersaleItemId: ids.aftersaleItemId, quantity: 2 }],
    reason: 'Refund the complete frozen aftersale allocation',
  });
  const created = await repository.createAftersaleRefundInTransaction(transaction, {
    actorAccountId: ids.actorId,
    aftersaleId: ids.aftersaleId,
    attemptIdempotencyKey: attemptKey,
    expectedVersion: preview.resourceVersion,
    items: [{ aftersaleItemId: ids.aftersaleItemId, quantity: 2 }],
    provider: 'MOCK',
    reason: 'Refund the complete frozen aftersale allocation',
  }, { verifyPreview: (current) => expect(current).toEqual(preview) });
  await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  return repository.claimRefundAttemptInTransaction(transaction, {
    refundAttemptId: created.attemptId,
    refundId: created.refundId,
  });
}

async function addZeroApprovedReturnLine(
  transaction: DatabaseTransaction,
  ids: Fixture,
  now: Date,
): Promise<void> {
  await transaction.sku.create({
    data: {
      code: `B124-SKU-${ids.zeroApprovedSkuId}`,
      created_at: now,
      id: ids.zeroApprovedSkuId,
      name: 'B12.4 Zero Approved SKU',
      product_id: ids.productId,
      retail_price: new Prisma.Decimal('10.00'),
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: ids.zeroApprovedBalanceId,
      locked_qty: 0,
      physical_qty: 3,
      sku_id: ids.zeroApprovedSkuId,
      updated_at: now,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal('10.00'),
      aftersale_reserved_qty: 1,
      brand_name_snapshot: `B124 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B124 Category ${ids.categoryId}`,
      created_at: now,
      id: ids.zeroApprovedOrderItemId,
      line_paid_amount: new Prisma.Decimal('10.00'),
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: `B124 Product ${ids.productId}`,
      quantity: 1,
      shipped_qty: 1,
      sku_code_snapshot: `B124-SKU-${ids.zeroApprovedSkuId}`,
      sku_id: ids.zeroApprovedSkuId,
      sku_name_snapshot: 'B12.4 Zero Approved SKU',
      unit_price: new Prisma.Decimal('10.00'),
    },
  });
  await transaction.aftersaleItem.create({
    data: {
      aftersale_id: ids.aftersaleId,
      created_at: now,
      id: ids.zeroApprovedAftersaleItemId,
      order_item_id: ids.zeroApprovedOrderItemId,
      requested_amount: new Prisma.Decimal('10.00'),
      requested_qty: 1,
      reserved_amount: new Prisma.Decimal('10.00'),
      reserved_qty: 1,
    },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: `B124 Category ${ids.categoryId}`,
      commission_base: new Prisma.Decimal('10.00'),
      created_at: now,
      effective_rate: new Prisma.Decimal('10.0000'),
      id: ids.zeroApprovedCommissionSnapshotId,
      order_item_id: ids.zeroApprovedOrderItemId,
      original_commission: new Prisma.Decimal('1.00'),
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleVersionId,
      sku_id_snapshot: ids.zeroApprovedSkuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      available_at: null,
      expected_remaining: new Prisma.Decimal('1.00'),
      id: ids.zeroApprovedCommissionPositionId,
      original_commission: new Prisma.Decimal('1.00'),
      reversed_total: new Prisma.Decimal('0.00'),
      snapshot_id: ids.zeroApprovedCommissionSnapshotId,
      state: 'EXPECTED',
      updated_at: now,
    },
  });
}

databaseDescribe('B12.4 Admin ordinary refund database integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    if (runtime === undefined) return;
    try {
      await assertNoFixtureFacts(runtime);
    } finally {
      await runtime.disconnect();
    }
  });

  it('atomically closes a pre-shipment full refund, restores inventory and cancels EXPECTED commission once', async () => {
    const now = new Date();
    const ids = fixture(now);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, { withAftersale: true });
      const operation = await createAndClaimAftersaleRefund(transaction, repository, ids, 'b124-first-attempt');
      const result = {
        kind: 'SUCCEEDED' as const,
        occurredAt: new Date(now.getTime() + 1_000),
        providerEventId: `mock_refund_event_${operation.attemptId}`,
        providerRefundId: `mock_refund_${operation.refundId}`,
      };
      const finalized = await repository.finalizeRefundAttemptInTransaction(transaction, { operation, result });
      expect(finalized).toMatchObject({
        changed: true,
        kind: 'SUCCEEDED',
        orderId: ids.orderId,
        refundId: operation.refundId,
      });
      expect(finalized.inventoryLedgerFacts).toEqual([
        expect.objectContaining({ ledgerType: 'REFUND_RESTOCK' }),
      ]);
      expect(finalized.commissionLedgerIds).toHaveLength(1);
      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
        .resolves.toMatchObject({
          close_reason: 'FULL_REFUND_BEFORE_SHIPMENT',
          fulfillment_status: 'CANCELLED',
          order_status: 'CLOSED',
          refund_processing_status: 'IDLE',
          refund_progress_status: 'FULL',
          refunded_amount: new Prisma.Decimal('20.00'),
        });
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .resolves.toMatchObject({
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          pre_shipment_refunded_qty: 2,
          refunded_amount: new Prisma.Decimal('20.00'),
          refunded_qty: 2,
        });
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: ids.balanceId } }))
        .resolves.toMatchObject({ physical_qty: 5 });
      await expect(transaction.product.findUniqueOrThrow({ where: { id: ids.productId } }))
        .resolves.toMatchObject({ sales_count: 0 });
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({
        where: { id: ids.commissionPositionId },
      })).resolves.toMatchObject({
        expected_remaining: new Prisma.Decimal('0.00'),
        reversed_total: new Prisma.Decimal('2.00'),
        state: 'CANCELLED',
      });
      const replayOperation = await repository.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: operation.attemptId,
        refundId: operation.refundId,
      });
      const replay = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation: replayOperation,
        result,
      });
      expect(replay).toMatchObject({
        changed: false,
        commissionLedgerIds: finalized.commissionLedgerIds,
        inventoryLedgerFacts: finalized.inventoryLedgerFacts,
        kind: 'REPLAY',
      });
      expect(await transaction.inventoryLedger.count({ where: { business_id: operation.refundId } })).toBe(1);
      expect(await transaction.commissionLedger.count({ where: { refund_id: operation.refundId } })).toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await expect(runtime.prisma.salesOrder.count({ where: { id: ids.orderId } })).resolves.toBe(0);
  }, 90_000);

  it('refunds only the approved quantity and amount after an abnormal partial return', async () => {
    const now = new Date();
    const ids = fixture(now);
    const inspectionId = generateUlid(now.getTime() + 1_000);
    const inspectionItemId = generateUlid(now.getTime() + 2_000);
    const evidenceFileId = generateUlid(now.getTime() + 3_000);
    const evidenceId = generateUlid(now.getTime() + 4_000);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, { withAftersale: true });
      await transaction.salesOrder.update({
        data: { fulfillment_status: 'DELIVERED', order_status: 'SHIPPING', updated_at: now },
        where: { id: ids.orderId },
      });
      await transaction.orderItem.update({
        data: {
          aftersale_reserved_amount: new Prisma.Decimal('10.00'),
          aftersale_reserved_qty: 1,
          shipped_qty: 2,
        },
        where: { id: ids.orderItemId },
      });
      await transaction.aftersale.update({
        data: { status: 'REFUNDING_AFTER_RETURN', type: 'RETURN_REFUND', updated_at: now },
        where: { id: ids.aftersaleId },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: 1n,
          created_at: now,
          created_by_id: ids.actorId,
          id: evidenceFileId,
          mime_type: 'image/png',
          object_key: `private/b124/${evidenceFileId}`,
          original_name: 'inspection.png',
          purpose: 'AFTERSALE_EVIDENCE',
          sha256: '1'.repeat(64),
          status: 'READY',
          visibility: 'PRIVATE',
        },
      });
      await transaction.returnInspection.create({
        data: {
          abnormal_reason: 'One returned unit remains with the customer',
          aftersale_id: ids.aftersaleId,
          created_at: now,
          evidence_count: 1,
          evidence_manifest: [evidenceFileId],
          id: inspectionId,
          inspected_at: now,
          inspected_by_id: ids.actorId,
          status: 'ABNORMAL',
          updated_at: now,
        },
      });
      await transaction.returnInspectionItem.create({
        data: {
          approved_refund_qty: 1,
          created_at: now,
          id: inspectionItemId,
          inspection_id: inspectionId,
          order_item_id: ids.orderItemId,
          received_qty: 2,
          restock_qty: 1,
          return_to_customer_qty: 1,
        },
      });
      await transaction.aftersaleEvidence.create({
        data: {
          aftersale_id: ids.aftersaleId,
          created_at: now,
          file_id: evidenceFileId,
          id: evidenceId,
          purpose: 'INSPECTION',
          return_inspection_id: inspectionId,
        },
      });
      await transaction.returnInspection.update({
        data: {
          resolution: 'CONTINUE_REFUND',
          resolution_note: 'Refund the one accepted returned unit',
          resolved_at: now,
          updated_at: now,
          version: { increment: 1 },
        },
        where: { id: inspectionId },
      });

      const preview = await repository.previewAftersaleRefundInTransaction(transaction, {
        actorAccountId: ids.actorId,
        aftersaleId: ids.aftersaleId,
        items: [{ aftersaleItemId: ids.aftersaleItemId, quantity: 1 }],
        reason: 'Refund only the approved returned unit',
      });
      expect(preview).toMatchObject({
        affectedCount: 1,
        amount: '10.00',
        items: [{
          aftersaleItemId: ids.aftersaleItemId,
          amount: '10.00',
          autoRestock: false,
          commissionReversal: '1.00',
          inventoryRestockQuantity: 1,
          quantity: 1,
        }],
      });
      const created = await repository.createAftersaleRefundInTransaction(transaction, {
        actorAccountId: ids.actorId,
        aftersaleId: ids.aftersaleId,
        attemptIdempotencyKey: 'b124-partial-return-attempt',
        expectedVersion: preview.resourceVersion,
        items: [{ aftersaleItemId: ids.aftersaleItemId, quantity: 1 }],
        provider: 'MOCK',
        reason: 'Refund only the approved returned unit',
      }, { verifyPreview: (current) => expect(current).toEqual(preview) });
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const operation = await repository.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: created.attemptId,
        refundId: created.refundId,
      });
      const finalized = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(now.getTime() + 5_000),
          providerEventId: `mock_partial_return_event_${operation.attemptId}`,
          providerRefundId: `mock_partial_return_refund_${operation.refundId}`,
        },
      });
      expect(finalized).toMatchObject({ changed: true, kind: 'SUCCEEDED' });
      expect(finalized.inventoryLedgerFacts.map(({ ledgerType }) => ledgerType).sort())
        .toEqual(['RETURN_DAMAGED', 'RETURN_RESTOCK']);
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .resolves.toMatchObject({
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          refunded_amount: new Prisma.Decimal('10.00'),
          refunded_qty: 1,
        });
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: ids.balanceId } }))
        .resolves.toMatchObject({ physical_qty: 4 });
      await expect(transaction.product.findUniqueOrThrow({ where: { id: ids.productId } }))
        .resolves.toMatchObject({ sales_count: 1 });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('excludes a zero-approved return line from refund items, inventory, sales, and commission reversal', async () => {
    const now = new Date();
    const ids = fixture(now);
    const inspectionId = generateUlid(now.getTime() + 1_000);
    const inspectionItemId = generateUlid(now.getTime() + 2_000);
    const zeroApprovedInspectionItemId = generateUlid(now.getTime() + 3_000);
    const evidenceFileId = generateUlid(now.getTime() + 4_000);
    const evidenceId = generateUlid(now.getTime() + 5_000);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, { primaryQuantity: 1, withAftersale: true });
      await addZeroApprovedReturnLine(transaction, ids, now);
      // CONTINUE_REFUND releases the zero-approved line's Order Item quota
      // before the refund command sees the resolved inspection.
      await transaction.orderItem.update({
        data: {
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          version: { increment: 1 },
        },
        where: { id: ids.zeroApprovedOrderItemId },
      });
      await transaction.salesOrder.update({
        data: { fulfillment_status: 'DELIVERED', order_status: 'SHIPPING', updated_at: now },
        where: { id: ids.orderId },
      });
      await transaction.orderItem.update({
        data: { shipped_qty: 1 },
        where: { id: ids.orderItemId },
      });
      await transaction.aftersale.update({
        data: { status: 'REFUNDING_AFTER_RETURN', type: 'RETURN_REFUND', updated_at: now },
        where: { id: ids.aftersaleId },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: 1n,
          created_at: now,
          created_by_id: ids.actorId,
          id: evidenceFileId,
          mime_type: 'image/png',
          object_key: `private/b124/${evidenceFileId}`,
          original_name: 'zero-approved-inspection.png',
          purpose: 'AFTERSALE_EVIDENCE',
          sha256: '2'.repeat(64),
          status: 'READY',
          visibility: 'PRIVATE',
        },
      });
      await transaction.returnInspection.create({
        data: {
          abnormal_reason: 'One returned line was sent back to the customer',
          aftersale_id: ids.aftersaleId,
          created_at: now,
          evidence_count: 1,
          evidence_manifest: [evidenceFileId],
          id: inspectionId,
          inspected_at: now,
          inspected_by_id: ids.actorId,
          status: 'ABNORMAL',
          updated_at: now,
        },
      });
      await transaction.returnInspectionItem.createMany({
        data: [{
          approved_refund_qty: 1,
          created_at: now,
          id: inspectionItemId,
          inspection_id: inspectionId,
          order_item_id: ids.orderItemId,
          received_qty: 1,
          restock_qty: 1,
          return_to_customer_qty: 0,
        }, {
          approved_refund_qty: 0,
          created_at: now,
          id: zeroApprovedInspectionItemId,
          inspection_id: inspectionId,
          order_item_id: ids.zeroApprovedOrderItemId,
          received_qty: 1,
          restock_qty: 0,
          return_to_customer_qty: 1,
        }],
      });
      await transaction.aftersaleEvidence.create({
        data: {
          aftersale_id: ids.aftersaleId,
          created_at: now,
          file_id: evidenceFileId,
          id: evidenceId,
          purpose: 'INSPECTION',
          return_inspection_id: inspectionId,
        },
      });
      await transaction.returnInspection.update({
        data: {
          resolution: 'CONTINUE_REFUND',
          resolution_note: 'Refund only the approved return line',
          resolved_at: now,
          updated_at: now,
          version: { increment: 1 },
        },
        where: { id: inspectionId },
      });

      const input = {
        actorAccountId: ids.actorId,
        aftersaleId: ids.aftersaleId,
        items: [{ aftersaleItemId: ids.aftersaleItemId, quantity: 1 }],
        reason: 'Refund the approved return line only',
      };
      const preview = await repository.previewAftersaleRefundInTransaction(transaction, input);
      expect(preview).toMatchObject({
        affectedCount: 1,
        amount: '10.00',
        items: [{
          aftersaleItemId: ids.aftersaleItemId,
          amount: '10.00',
          autoRestock: false,
          commissionReversal: '1.00',
          inventoryRestockQuantity: 1,
          orderItemId: ids.orderItemId,
          quantity: 1,
          skuId: ids.skuId,
        }],
      });
      expect(preview.items.some((item) => item.aftersaleItemId === ids.zeroApprovedAftersaleItemId)).toBe(false);

      const created = await repository.createAftersaleRefundInTransaction(transaction, {
        ...input,
        attemptIdempotencyKey: 'b124-zero-approved-line-attempt',
        expectedVersion: preview.resourceVersion,
        provider: 'MOCK',
      }, { verifyPreview: (current) => expect(current).toEqual(preview) });
      expect(created.items).toEqual(preview.items);
      expect(await transaction.refundItem.findMany({
        orderBy: { order_item_id: 'asc' },
        where: { refund_id: created.refundId },
      })).toEqual([expect.objectContaining({
        aftersale_item_id: ids.aftersaleItemId,
        amount: new Prisma.Decimal('10.00'),
        order_item_id: ids.orderItemId,
        quantity: 1,
      })]);
      expect(await transaction.refundItem.count({
        where: { aftersale_item_id: ids.zeroApprovedAftersaleItemId },
      })).toBe(0);
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const operation = await repository.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: created.attemptId,
        refundId: created.refundId,
      });
      const finalized = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(now.getTime() + 6_000),
          providerEventId: `mock_zero_approved_event_${operation.attemptId}`,
          providerRefundId: `mock_zero_approved_refund_${operation.refundId}`,
        },
      });
      expect(finalized).toMatchObject({
        changed: true,
        kind: 'SUCCEEDED',
        inventoryLedgerFacts: [{ ledgerType: 'RETURN_RESTOCK' }],
      });
      await expect(transaction.aftersale.findUniqueOrThrow({ where: { id: ids.aftersaleId } }))
        .resolves.toMatchObject({ status: 'COMPLETED' });
      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
        .resolves.toMatchObject({
          fulfillment_status: 'DELIVERED',
          order_status: 'SHIPPING',
          refund_progress_status: 'PARTIAL',
          refunded_amount: new Prisma.Decimal('10.00'),
        });
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .resolves.toMatchObject({
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          refunded_amount: new Prisma.Decimal('10.00'),
          refunded_qty: 1,
        });
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.zeroApprovedOrderItemId } }))
        .resolves.toMatchObject({
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          refunded_amount: new Prisma.Decimal('0.00'),
          refunded_qty: 0,
          version: 2,
        });
      await expect(transaction.aftersaleItem.findUniqueOrThrow({ where: { id: ids.zeroApprovedAftersaleItemId } }))
        .resolves.toMatchObject({
          refunded_amount: new Prisma.Decimal('0.00'),
          refunded_qty: 0,
        });
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: ids.balanceId } }))
        .resolves.toMatchObject({ physical_qty: 4 });
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: ids.zeroApprovedBalanceId } }))
        .resolves.toMatchObject({ physical_qty: 3, version: 1 });
      await expect(transaction.product.findUniqueOrThrow({ where: { id: ids.productId } }))
        .resolves.toMatchObject({ sales_count: 1 });
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({
        where: { id: ids.zeroApprovedCommissionPositionId },
      })).resolves.toMatchObject({
        expected_remaining: new Prisma.Decimal('1.00'),
        reversed_total: new Prisma.Decimal('0.00'),
        state: 'EXPECTED',
        version: 1,
      });
      expect(await transaction.commissionLedger.count({ where: { refund_id: created.refundId } })).toBe(1);
      expect(await transaction.commissionLedger.count({
        where: { snapshot_id: ids.zeroApprovedCommissionSnapshotId },
      })).toBe(0);
      expect(await transaction.inventoryLedger.count({ where: { sku_id: ids.zeroApprovedSkuId } })).toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('keeps quota on failure, appends one retry attempt and converges the same stable refund', async () => {
    const now = new Date();
    const ids = fixture(now);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, { withAftersale: true });
      const first = await createAndClaimAftersaleRefund(transaction, repository, ids, 'b124-failed-attempt');
      const failed = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation: first,
        result: {
          failureCode: 'PROVIDER_FAILED',
          kind: 'FAILED',
          occurredAt: new Date(now.getTime() + 1_000),
          providerEventId: `mock_failed_event_${first.attemptId}`,
          providerRefundId: `mock_refund_${first.refundId}`,
        },
      });
      expect(failed).toMatchObject({ changed: true, kind: 'FAILED' });
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .resolves.toMatchObject({ aftersale_reserved_qty: 2, refunded_qty: 0 });
      const preview = await repository.previewRetryRefundInTransaction(transaction, {
        actorAccountId: ids.actorId,
        reason: 'Retry the same failed Provider refund',
        refundId: first.refundId,
      });
      await expect(repository.prepareRetryRefundInTransaction(transaction, {
        actorAccountId: ids.actorId,
        attemptIdempotencyKey: 'b124-failed-attempt',
        expectedVersion: preview.resourceVersion,
        reason: 'Retry the same failed Provider refund',
        refundId: first.refundId,
      }, { verifyPreview: (current) => expect(current).toEqual(preview) }))
        .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(await transaction.refundAttempt.count({ where: { refund_id: first.refundId } })).toBe(1);
      const prepared = await repository.prepareRetryRefundInTransaction(transaction, {
        actorAccountId: ids.actorId,
        attemptIdempotencyKey: 'b124-retry-attempt',
        expectedVersion: preview.resourceVersion,
        reason: 'Retry the same failed Provider refund',
        refundId: first.refundId,
      }, { verifyPreview: (current) => expect(current).toEqual(preview) });
      expect(prepared).toMatchObject({
        attemptNo: 2,
        refundId: first.refundId,
        refundNo: first.refundNo,
      });
      const historicalCallback = {
        amount: first.amount,
        attemptNo: first.attemptNo,
        outcome: 'FAILED' as const,
        providerEventId: `mock_failed_event_${first.attemptId}`,
        providerRefundId: `mock_refund_${first.refundId}`,
        refundAttemptId: first.attemptId,
        refundId: first.refundId,
        refundNo: first.refundNo,
      };
      await expect(repository.isHistoricalRefundAttemptReplayInTransaction(transaction, historicalCallback))
        .resolves.toBe(true);
      await expect(repository.isHistoricalRefundAttemptReplayInTransaction(transaction, {
        ...historicalCallback,
        providerEventId: `mock_conflicting_event_${first.attemptId}`,
      })).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
      await expect(transaction.refund.findUniqueOrThrow({ where: { id: first.refundId } }))
        .resolves.toMatchObject({ status: 'PENDING', version: prepared.version });
      await expect(transaction.refundAttempt.findUniqueOrThrow({ where: { id: prepared.attemptId } }))
        .resolves.toMatchObject({ status: 'INITIATED' });
      const retry = await repository.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: prepared.attemptId,
        refundId: prepared.refundId,
      });
      const succeeded = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation: retry,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(now.getTime() + 2_000),
          providerEventId: `mock_success_event_${retry.attemptId}`,
          providerRefundId: `mock_refund_${retry.refundId}`,
        },
      });
      expect(succeeded).toMatchObject({ changed: true, kind: 'SUCCEEDED', refundId: first.refundId });
      const ledgerCounts = {
        commission: await transaction.commissionLedger.count({ where: { refund_id: first.refundId } }),
        inventory: await transaction.inventoryLedger.count({ where: { business_id: first.refundId } }),
      };
      await expect(repository.isHistoricalRefundAttemptReplayInTransaction(transaction, historicalCallback))
        .resolves.toBe(true);
      await expect(transaction.refund.findUniqueOrThrow({ where: { id: first.refundId } }))
        .resolves.toMatchObject({ status: 'SUCCEEDED', version: succeeded.afterRefundVersion });
      await expect(transaction.refundAttempt.findUniqueOrThrow({ where: { id: prepared.attemptId } }))
        .resolves.toMatchObject({ status: 'SUCCEEDED' });
      expect(await transaction.commissionLedger.count({ where: { refund_id: first.refundId } }))
        .toBe(ledgerCounts.commission);
      expect(await transaction.inventoryLedger.count({ where: { business_id: first.refundId } }))
        .toBe(ledgerCounts.inventory);
      expect(await transaction.refund.count({ where: { aftersale_id: ids.aftersaleId } })).toBe(1);
      expect(await transaction.refundAttempt.count({ where: { refund_id: first.refundId } })).toBe(2);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('debits AVAILABLE commission when completion wins before refund finalization', async () => {
    const now = new Date();
    const ids = fixture(now);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, {
        commissionState: 'AVAILABLE',
        withAftersale: true,
      });
      const operation = await createAndClaimAftersaleRefund(
        transaction,
        repository,
        ids,
        'b124-completion-wins-attempt',
      );
      const finalized = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(now.getTime() + 1_000),
          providerEventId: `mock_completion_wins_event_${operation.attemptId}`,
          providerRefundId: `mock_completion_wins_refund_${operation.refundId}`,
        },
      });
      expect(finalized).toMatchObject({ changed: true, kind: 'SUCCEEDED' });
      expect(finalized.commissionLedgerIds).toHaveLength(1);
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({
        where: { id: ids.commissionPositionId },
      })).resolves.toMatchObject({
        expected_remaining: new Prisma.Decimal('0.00'),
        reversed_total: new Prisma.Decimal('2.00'),
        state: 'AVAILABLE',
      });
      await expect(transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } }))
        .resolves.toMatchObject({ available_balance: new Prisma.Decimal('0.00'), version: 2 });
      const refundDebits = await transaction.commissionLedger.findMany({
        where: { refund_id: operation.refundId },
      });
      expect(refundDebits).toEqual([expect.objectContaining({
        available_change: new Prisma.Decimal('-2.00'),
        expected_change: new Prisma.Decimal('0.00'),
        ledger_type: 'REFUND_DEBIT',
      })]);
      const netAvailable = await transaction.commissionLedger.aggregate({
        _sum: { available_change: true },
        where: { agent_id: ids.agentId },
      });
      expect(netAvailable._sum.available_change).toEqual(new Prisma.Decimal('0.00'));
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('settles manual compensation as amount-only with no quantity or inventory mutation', async () => {
    const now = new Date();
    const ids = fixture(now);
    const repository = new AdminRefundRepository(runtime.prisma);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedPaidRefundFixture(transaction, ids, now, { withAftersale: false });
      const preview = await repository.previewManualCompensationInTransaction(transaction, {
        actorAccountId: ids.actorId,
        amount: '5.00',
        orderId: ids.orderId,
        orderItemId: ids.orderItemId,
        provider: 'MOCK',
        reason: 'Compensate a verified service issue',
      });
      const created = await repository.createManualCompensationInTransaction(transaction, {
        actorAccountId: ids.actorId,
        amount: '5.00',
        attemptIdempotencyKey: 'b124-compensation-attempt',
        expectedVersion: preview.resourceVersion,
        orderId: ids.orderId,
        orderItemId: ids.orderItemId,
        provider: 'MOCK',
        reason: 'Compensate a verified service issue',
      }, { verifyPreview: (current) => expect(current).toEqual(preview) });
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const operation = await repository.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: created.attemptId,
        refundId: created.refundId,
      });
      const finalized = await repository.finalizeRefundAttemptInTransaction(transaction, {
        operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(now.getTime() + 1_000),
          providerEventId: `mock_comp_event_${operation.attemptId}`,
          providerRefundId: `mock_comp_refund_${operation.refundId}`,
        },
      });
      expect(finalized.inventoryLedgerFacts).toEqual([]);
      await expect(transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .resolves.toMatchObject({
          aftersale_reserved_amount: new Prisma.Decimal('0.00'),
          aftersale_reserved_qty: 0,
          refunded_amount: new Prisma.Decimal('5.00'),
          refunded_qty: 0,
        });
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: ids.balanceId } }))
        .resolves.toMatchObject({ physical_qty: 3, version: 1 });
      await expect(transaction.product.findUniqueOrThrow({ where: { id: ids.productId } }))
        .resolves.toMatchObject({ sales_count: 2 });
      await expect(transaction.manualCompensation.findUniqueOrThrow({ where: { id: created.compensationId! } }))
        .resolves.toMatchObject({
          refunded_amount: new Prisma.Decimal('5.00'),
          reserved_amount: new Prisma.Decimal('0.00'),
          status: 'SUCCEEDED',
        });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);
});
