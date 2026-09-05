import { randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { AdminAnalyticsRepository } from './admin-analytics.repository';
import { adminCustomerAlias } from './admin-customer.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

const mode = process.env.B141_ADMIN_ANALYTICS_DATABASE_TEST_MODE;
if (mode !== undefined && mode !== 'rollback') {
  throw new TypeError('B141_ADMIN_ANALYTICS_DATABASE_TEST_MODE must be rollback');
}
const databaseDescribe = mode === 'rollback' ? describe : describe.skip;
const rollbackSentinel = Object.freeze({ code: 'B141_ADMIN_ANALYTICS_ROLLBACK_SENTINEL' });
const transactionOptions = { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 };

interface FixtureIds {
  accountAdminId: string;
  accountAgentId: string;
  accountCustomerId: string;
  agentId: string;
  bindingId: string;
  brandId: string;
  categoryId: string;
  customerId: string;
  directCandidateId: string;
  directItemId: string;
  directOrderId: string;
  directSnapshotId: string;
  manualCompensationId: string;
  manualRefundId: string;
  manualRefundItemId: string;
  productId: string;
  promotedCandidateId: string;
  promotedItemId: string;
  promotedSecondItemId: string;
  promotedOrderId: string;
  promotedSnapshotId: string;
  quantityRefundId: string;
  quantityRefundItemId: string;
  skuAId: string;
  skuBId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B14.1 Analytics database tests`);
  return value;
}

function runtimeForRollback(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  const url = new URL(databaseUrl);
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b141-analytics-rollback',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 2,
    });
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b141-analytics-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 2,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function transactionBoundPrisma(transaction: DatabaseTransaction): PrismaClient {
  return new Proxy(transaction as unknown as PrismaClient, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function fixtureIds(): FixtureIds {
  const ids = Array.from({ length: 24 }, () => generateUlid());
  const [skuAId, skuBId] = [ids[21]!, ids[22]!].sort();
  return {
    accountAdminId: ids[0]!,
    accountAgentId: ids[1]!,
    accountCustomerId: ids[2]!,
    agentId: ids[3]!,
    bindingId: ids[4]!,
    brandId: ids[5]!,
    categoryId: ids[6]!,
    customerId: ids[7]!,
    directCandidateId: ids[8]!,
    directItemId: ids[9]!,
    directOrderId: ids[10]!,
    directSnapshotId: ids[11]!,
    manualCompensationId: ids[12]!,
    manualRefundId: ids[13]!,
    manualRefundItemId: ids[14]!,
    productId: ids[15]!,
    promotedCandidateId: ids[16]!,
    promotedItemId: ids[17]!,
    promotedSecondItemId: ids[20]!,
    promotedOrderId: ids[18]!,
    promotedSnapshotId: ids[19]!,
    quantityRefundId: generateUlid(),
    quantityRefundItemId: ids[23]!,
    skuAId,
    skuBId,
  };
}

function shanghaiDate(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

async function seedFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  boundary: Date,
  asOf: Date,
): Promise<{ beforeBoundary: Date; refundAt: Date }> {
  const suffix = randomUUID();
  const beforeBoundary = new Date(boundary.getTime() - 1);
  const refundAt = new Date(boundary.getTime() + 24 * 60 * 60_000 + 60 * 60_000);
  const registeredAt = new Date(boundary.getTime() - 2 * 60 * 60_000);
  await transaction.account.createMany({
    data: [
      {
        created_at: registeredAt,
        id: ids.accountAdminId,
        login_name: `b141-admin-${suffix}`,
        must_change_password: false,
        password_hash: 'b141-fixture-password-hash',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: asOf,
      },
      {
        created_at: registeredAt,
        id: ids.accountAgentId,
        login_name: `b141-agent-${suffix}`,
        must_change_password: false,
        password_hash: 'b141-fixture-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: asOf,
      },
      {
        created_at: registeredAt,
        id: ids.accountCustomerId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: asOf,
        wechat_open_id: `b141-customer-${suffix}`,
      },
    ],
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.accountAgentId,
      agent_no: `B141-${ids.agentId.slice(-20)}`,
      created_at: registeredAt,
      id: ids.agentId,
      name: 'B14.1 Analytics Agent',
      status: 'ACTIVE',
      updated_at: asOf,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.accountCustomerId,
      created_at: registeredAt,
      id: ids.customerId,
      nickname: 'Fixture Customer',
      registered_at: registeredAt,
      updated_at: asOf,
    },
  });
  await transaction.customerAgentBinding.create({
    data: {
      agent_id: ids.agentId,
      created_at: registeredAt,
      customer_id: ids.customerId,
      id: ids.bindingId,
      started_at: registeredAt,
    },
  });
  await transaction.brand.create({
    data: { created_at: registeredAt, id: ids.brandId, name: `B14.1 Brand ${suffix}`, updated_at: asOf },
  });
  await transaction.category.create({
    data: { created_at: registeredAt, id: ids.categoryId, name: `B14.1 Category ${suffix}`, updated_at: asOf },
  });
  await transaction.product.create({
    data: {
      brand_id: ids.brandId,
      category_id: ids.categoryId,
      created_at: registeredAt,
      id: ids.productId,
      name: 'B14.1 Product',
      published_at: registeredAt,
      spu_code: `B141-SPU-${suffix}`,
      status: 'ACTIVE',
      updated_at: asOf,
    },
  });
  await transaction.sku.createMany({
    data: [
      {
        code: `B141-A-${suffix}`,
        created_at: registeredAt,
        id: ids.skuAId,
        name: 'SKU A',
        product_id: ids.productId,
        retail_price: new Prisma.Decimal('10.00'),
        updated_at: asOf,
      },
      {
        code: `B141-B-${suffix}`,
        created_at: registeredAt,
        id: ids.skuBId,
        name: 'SKU B',
        product_id: ids.productId,
        retail_price: new Prisma.Decimal('30.00'),
        updated_at: asOf,
      },
    ],
  });
  await transaction.salesOrder.createMany({
    data: [
      {
        created_at: beforeBoundary,
        final_channel: 'DIRECT',
        goods_amount: new Prisma.Decimal('10.00'),
        id: ids.directOrderId,
        order_no: `B14D${ids.directOrderId}`,
        order_status: 'PENDING_SHIPMENT',
        paid_amount: new Prisma.Decimal('10.00'),
        paid_at: beforeBoundary,
        payable_amount: new Prisma.Decimal('10.00'),
        payment_status: 'PAID',
        pay_expires_at: new Date(beforeBoundary.getTime() + 30 * 60_000),
        source: 'BUY_NOW',
        updated_at: asOf,
        customer_id: ids.customerId,
      },
      {
        created_at: boundary,
        final_agent_id: ids.agentId,
        final_channel: 'AGENT',
        goods_amount: new Prisma.Decimal('30.00'),
        id: ids.promotedOrderId,
        order_no: `B14A${ids.promotedOrderId}`,
        order_status: 'PENDING_SHIPMENT',
        paid_amount: new Prisma.Decimal('30.00'),
        paid_at: boundary,
        payable_amount: new Prisma.Decimal('30.00'),
        payment_status: 'PAID',
        pay_expires_at: new Date(boundary.getTime() + 30 * 60_000),
        refunded_amount: new Prisma.Decimal('17.00'),
        refund_progress_status: 'PARTIAL',
        source: 'BUY_NOW',
        updated_at: asOf,
        customer_id: ids.customerId,
      },
    ],
  });
  await transaction.orderItem.createMany({
    data: [
      {
        brand_name_snapshot: 'B14.1 Brand',
        category_id: ids.categoryId,
        category_name_snapshot: 'B14.1 Category',
        created_at: beforeBoundary,
        id: ids.directItemId,
        line_paid_amount: new Prisma.Decimal('10.00'),
        order_id: ids.directOrderId,
        product_id: ids.productId,
        product_name_snapshot: 'B14.1 Product',
        quantity: 1,
        sku_code_snapshot: 'B141-A',
        sku_id: ids.skuAId,
        sku_name_snapshot: 'SKU A',
        unit_price: new Prisma.Decimal('10.00'),
      },
      {
        brand_name_snapshot: 'B14.1 Brand',
        category_id: ids.categoryId,
        category_name_snapshot: 'B14.1 Category',
        created_at: boundary,
        id: ids.promotedItemId,
        line_paid_amount: new Prisma.Decimal('17.00'),
        order_id: ids.promotedOrderId,
        product_id: ids.productId,
        product_name_snapshot: 'B14.1 Product',
        quantity: 1,
        refunded_amount: new Prisma.Decimal('17.00'),
        refunded_qty: 1,
        sku_code_snapshot: 'B141-B',
        sku_id: ids.skuBId,
        sku_name_snapshot: 'SKU B',
        unit_price: new Prisma.Decimal('17.00'),
      },
      {
        brand_name_snapshot: 'B14.1 Brand',
        category_id: ids.categoryId,
        category_name_snapshot: 'B14.1 Category',
        created_at: boundary,
        id: ids.promotedSecondItemId,
        line_paid_amount: new Prisma.Decimal('13.00'),
        order_id: ids.promotedOrderId,
        product_id: ids.productId,
        product_name_snapshot: 'B14.1 Product',
        quantity: 1,
        sku_code_snapshot: 'B141-A',
        sku_id: ids.skuAId,
        sku_name_snapshot: 'SKU A',
        unit_price: new Prisma.Decimal('13.00'),
      },
    ],
  });
  await transaction.orderAttributionCandidate.createMany({
    data: [
      {
        binding_id: ids.bindingId,
        candidate_agent_id: ids.agentId,
        finalization_result: 'FINAL_DIRECT',
        finalized_at: beforeBoundary,
        id: ids.directCandidateId,
        order_id: ids.directOrderId,
        submit_channel: 'AGENT',
        submitted_at: beforeBoundary,
      },
      {
        finalization_result: 'FINAL_AGENT',
        finalized_at: boundary,
        id: ids.promotedCandidateId,
        order_id: ids.promotedOrderId,
        submit_channel: 'DIRECT',
        submitted_at: boundary,
      },
    ],
  });
  await transaction.orderAttributionSnapshot.createMany({
    data: [
      {
        captured_at: beforeBoundary,
        final_channel: 'DIRECT',
        id: ids.directSnapshotId,
        order_id: ids.directOrderId,
      },
      {
        agent_id_snapshot: ids.agentId,
        binding_id_snapshot: ids.bindingId,
        captured_at: boundary,
        final_channel: 'AGENT',
        id: ids.promotedSnapshotId,
        order_id: ids.promotedOrderId,
      },
    ],
  });
  await transaction.refund.create({
    data: {
      amount: new Prisma.Decimal('12.00'),
      id: ids.quantityRefundId,
      is_late_payment_refund: true,
      order_id: ids.promotedOrderId,
      origin_type: 'LATE_PAYMENT',
      provider: 'MOCK',
      provider_refund_id: `b141-quantity-${suffix}`,
      reason: 'B14.1 quantity refund',
      refund_no: `B14Q${ids.quantityRefundId}`,
      requested_at: refundAt,
      status: 'SUCCEEDED',
      succeeded_at: refundAt,
      updated_at: refundAt,
    },
  });
  await transaction.refundItem.create({
    data: {
      amount: new Prisma.Decimal('12.00'),
      created_at: refundAt,
      id: ids.quantityRefundItemId,
      order_item_id: ids.promotedItemId,
      quantity: 1,
      refund_id: ids.quantityRefundId,
    },
  });
  await transaction.manualCompensation.create({
    data: {
      amount: new Prisma.Decimal('5.00'),
      approved_by_id: ids.accountAdminId,
      completed_at: refundAt,
      compensation_no: `B14C${ids.manualCompensationId}`,
      created_at: refundAt,
      customer_id: ids.customerId,
      id: ids.manualCompensationId,
      order_id: ids.promotedOrderId,
      order_item_id: ids.promotedItemId,
      reason: 'B14.1 amount-only compensation',
      refunded_amount: new Prisma.Decimal('5.00'),
      reserved_amount: new Prisma.Decimal('5.00'),
      status: 'SUCCEEDED',
      updated_at: refundAt,
    },
  });
  await transaction.refund.create({
    data: {
      amount: new Prisma.Decimal('5.00'),
      id: ids.manualRefundId,
      manual_compensation_id: ids.manualCompensationId,
      order_id: ids.promotedOrderId,
      origin_type: 'MANUAL_COMPENSATION',
      provider: 'MOCK',
      provider_refund_id: `b141-manual-${suffix}`,
      reason: 'B14.1 amount-only compensation',
      refund_no: `B14M${ids.manualRefundId}`,
      requested_at: refundAt,
      status: 'SUCCEEDED',
      succeeded_at: refundAt,
      updated_at: refundAt,
    },
  });
  await transaction.refundItem.create({
    data: {
      amount: new Prisma.Decimal('5.00'),
      created_at: refundAt,
      id: ids.manualRefundItemId,
      order_item_id: ids.promotedItemId,
      quantity: 1,
      refund_id: ids.manualRefundId,
    },
  });
  return { beforeBoundary, refundAt };
}

databaseDescribe('B14.1 Admin Analytics PostgreSQL repository', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForRollback();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('uses submission/payment snapshots, Shanghai boundaries and amount-only refund semantics', async () => {
    const ids = fixtureIds();
    const aliasKey = Buffer.alloc(32, 14);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      const timeRows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
        Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
      );
      const transactionTime = timeRows[0]?.transaction_time;
      if (!(transactionTime instanceof Date)) throw new TypeError('Database transaction time is unavailable');
      const boundary = new Date('2001-01-01T16:00:00.000Z');
      const { beforeBoundary, refundAt } = await seedFixture(transaction, ids, boundary, transactionTime);
      const repository = new AdminAnalyticsRepository(transactionBoundPrisma(transaction), aliasKey);
      const dateFrom = shanghaiDate(beforeBoundary);
      const paymentDate = shanghaiDate(boundary);
      const refundDate = shanghaiDate(refundAt);

      const agent = await repository.listDailySales({
        agentId: ids.agentId,
        dateFrom,
        dateTo: refundDate,
        page: 1,
        pageSize: 20,
        scope: 'AGENT',
      });
      expect(agent.rows.find((row) => row.businessDate === dateFrom)).toMatchObject({
        createdOrderCount: 1,
        customerTotalSnapshot: 0,
        newRegistrationCount: 0,
        paidAmount: '0.00',
      });
      expect(agent.rows.find((row) => row.businessDate === paymentDate)).toMatchObject({
        activeAgentCount: 0,
        createdOrderCount: 0,
        paidAmount: '30.00',
        paidUnits: 2,
      });
      expect(agent.rows.find((row) => row.businessDate === refundDate)).toMatchObject({
        netSalesAmount: '-17.00',
        netUnits: -1,
        refundedAmount: '17.00',
        refundedUnits: 1,
      });

      const direct = await repository.listDailySales({
        dateFrom,
        dateTo: paymentDate,
        page: 1,
        pageSize: 20,
        scope: 'DIRECT',
      });
      expect(direct.rows.find((row) => row.businessDate === dateFrom)).toMatchObject({
        createdOrderCount: 0,
        paidAmount: '10.00',
      });
      expect(direct.rows.find((row) => row.businessDate === paymentDate)).toMatchObject({
        activeAgentCount: 0,
        createdOrderCount: 1,
        paidAmount: '0.00',
      });

      const paidRanking = await repository.listProductRanking({
        agentId: ids.agentId,
        dateFrom,
        dateTo: paymentDate,
        page: 1,
        pageSize: 20,
        scope: 'AGENT',
      });
      expect(paidRanking.rows.map(({ rank, skuId }) => ({ rank, skuId }))).toEqual([
        { rank: 1, skuId: ids.skuAId },
        { rank: 2, skuId: ids.skuBId },
      ]);

      const refundRanking = await repository.listProductRanking({
        agentId: ids.agentId,
        dateFrom: refundDate,
        dateTo: refundDate,
        page: 1,
        pageSize: 20,
        scope: 'AGENT',
      });
      expect(refundRanking.rows).toEqual([expect.objectContaining({
        netSalesAmount: '-17.00',
        netUnits: -1,
        refundedAmount: '17.00',
        refundedUnits: 1,
        skuId: ids.skuBId,
      })]);

      const customers = await repository.listCustomerRanking({
        agentId: ids.agentId,
        dateFrom,
        dateTo: refundDate,
        page: 1,
        pageSize: 20,
        scope: 'AGENT',
      });
      expect(customers.rows[0]).toMatchObject({
        customerAlias: adminCustomerAlias(ids.customerId, aliasKey),
        customerId: ids.customerId,
        netConsumptionAmount: '13.00',
      });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);
});
