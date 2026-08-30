import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  type PaymentReconciliationListInput,
  PaymentReconciliationRepository,
  type PaymentReconciliationTask,
} from './payment-reconciliation.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StoreOrderRepository } from './store-order.repository';
import { StorePaymentRepository } from './store-payment.repository';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B10_STORE_PAYMENT_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B10_STORE_PAYMENT_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const rollbackSentinel = Object.freeze({ code: 'B10_STORE_PAYMENT_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B10 Store payment database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B10 Store payment tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B10 Store payment tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b101-store-payment-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B10 Store payment tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b101-store-payment-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

interface SettlementFixture {
  accountId: string;
  addressId: string;
  attributionId: string;
  balanceId: string;
  brandId: string;
  categoryId: string;
  customerId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  reservationId: string;
  reservationItemId: string;
  reserveLedgerId: string;
  skuId: string;
}

interface AdditionalSettlementLineFixture {
  balanceId: string;
  orderItemId: string;
  productId: string;
  reservationItemId: string;
  reserveLedgerId: string;
  skuId: string;
}

interface AgentCommissionFixture {
  agentAccountId: string;
  agentId: string;
  bindingId: string;
  ruleEntryId: string;
  ruleVersionId: string;
}

function settlementFixture(now: Date): SettlementFixture {
  const id = (offset: number) => generateUlid(now.getTime() - offset);
  return {
    accountId: id(14_000),
    addressId: id(3_900),
    attributionId: id(3_800),
    balanceId: id(8_000),
    brandId: id(12_000),
    categoryId: id(11_000),
    customerId: id(13_000),
    orderId: id(6_000),
    orderItemId: id(5_000),
    productId: id(10_000),
    reservationId: id(4_000),
    reservationItemId: id(3_700),
    reserveLedgerId: id(3_600),
    skuId: id(9_000),
  };
}

function additionalSettlementLineFixture(
  now: Date,
  productId = generateUlid(now.getTime() - 2_400),
): AdditionalSettlementLineFixture {
  return {
    balanceId: generateUlid(now.getTime() - 2_300),
    orderItemId: generateUlid(now.getTime() - 2_200),
    productId,
    reservationItemId: generateUlid(now.getTime() - 2_100),
    reserveLedgerId: generateUlid(now.getTime() - 2_000),
    skuId: generateUlid(now.getTime() - 2_350),
  };
}

function agentCommissionFixture(now: Date): AgentCommissionFixture {
  return {
    agentAccountId: generateUlid(now.getTime() - 17_000),
    agentId: generateUlid(now.getTime() - 16_000),
    bindingId: generateUlid(now.getTime() - 15_000),
    ruleEntryId: generateUlid(now.getTime() - 1_900),
    ruleVersionId: generateUlid(now.getTime() - 2_000),
  };
}

function reconciliationRepositoryForTransaction(
  transaction: DatabaseTransaction,
): PaymentReconciliationRepository {
  const client = {
    $transaction: async (callback: (current: DatabaseTransaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaClient;
  return new PaymentReconciliationRepository(client);
}

async function findReconciliationTask(
  repository: PaymentReconciliationRepository,
  filters: Omit<PaymentReconciliationListInput, 'page' | 'pageSize'>,
  predicate: (task: PaymentReconciliationTask) => boolean,
): Promise<PaymentReconciliationTask | null> {
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const result = await repository.listTasks({ ...filters, page, pageSize });
    const task = result.items.find(predicate);
    if (task !== undefined) return task;
    if (page * pageSize >= result.total) return null;
  }
}

async function seedActiveAgentWithPublishedCommission(
  transaction: DatabaseTransaction,
  fixture: AgentCommissionFixture,
  now: Date,
  rate: string,
): Promise<void> {
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.agentAccountId,
      login_name: `b102-agent-${fixture.agentAccountId}`,
      password_hash: 'b102-integration-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: fixture.agentAccountId,
      agent_no: `B102-${fixture.agentId.slice(-20)}`,
      created_at: now,
      id: fixture.agentId,
      name: 'B10.2 Integration Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  const publishedRules = await transaction.commissionRuleVersion.findMany({
    select: { id: true },
    where: { status: 'PUBLISHED' },
  });
  for (const published of publishedRules) {
    await transaction.commissionRuleVersion.update({
      data: { status: 'ARCHIVED' },
      where: { id: published.id },
    });
  }
  const maximumVersion = await transaction.commissionRuleVersion.aggregate({
    _max: { version_no: true },
  });
  const versionNo = (maximumVersion._max.version_no ?? 0) + 1;
  expect(Number.isSafeInteger(versionNo)).toBe(true);
  await transaction.commissionRuleVersion.create({
    data: {
      created_at: now,
      created_by_id: fixture.agentAccountId,
      effective_at: null,
      id: fixture.ruleVersionId,
      reason: `B10.2 ${rate} commission integration fixture`,
      status: 'DRAFT',
      version_no: versionNo,
    },
  });
  await transaction.commissionRuleEntry.create({
    data: {
      configured_rate: new Prisma.Decimal(rate),
      created_at: now,
      id: fixture.ruleEntryId,
      rule_version_id: fixture.ruleVersionId,
      target_id: null,
      target_key: 'PLATFORM',
      target_type: 'PLATFORM',
    },
  });
  await transaction.commissionRuleVersion.update({
    data: {
      effective_at: new Date(now.getTime() - 60_000),
      status: 'PUBLISHED',
    },
    where: { id: fixture.ruleVersionId },
  });
}

async function seedSettlementFixture(
  transaction: DatabaseTransaction,
  fixture: SettlementFixture,
  now: Date,
  options: {
    agent?: { agentId: string; bindingId: string };
    createBalance?: boolean;
    expiresAt?: Date;
    paymentStatus?: 'PROCESSING' | 'UNPAID';
    primaryPhysicalQty?: number;
    primaryQuantity?: number;
  } = {},
): Promise<void> {
  const {
    agent,
    createBalance = true,
    expiresAt = new Date(now.getTime() + 30 * 60_000),
    paymentStatus = 'UNPAID',
    primaryPhysicalQty = 5,
    primaryQuantity = 1,
  } = options;
  const primaryAmount = new Prisma.Decimal('19.90').mul(primaryQuantity);
  const orderCreatedAt = new Date(expiresAt.getTime() - 30 * 60_000);
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.accountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
      wechat_open_id: `b102-customer-${fixture.accountId}`,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.accountId,
      created_at: now,
      id: fixture.customerId,
      nickname: 'Fixture Customer',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerPhoneVerification.create({
    data: {
      consent_version: 'b102-test-consent-v1',
      created_at: now,
      customer_id: fixture.customerId,
      encryption_key_id: 'b102-test-field-v1',
      id: generateUlid(now.getTime() - 12_500),
      phone_ciphertext: Buffer.from(`b102-phone-${fixture.customerId}`),
      phone_hash: Buffer.from(fixture.customerId).toString('hex').padEnd(64, '0'),
      phone_last4: '4826',
      revoked_at: null,
      source: 'B10_INTEGRATION',
      verified_at: new Date(now.getTime() - 60_000),
    },
  });
  if (agent) {
    await transaction.customerAgentBinding.create({
      data: {
        agent_id: agent.agentId,
        created_at: new Date(now.getTime() - 120_000),
        customer_id: fixture.customerId,
        ended_at: null,
        id: agent.bindingId,
        started_at: new Date(now.getTime() - 120_000),
      },
    });
  }
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B102 Brand ${fixture.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B102 Category ${fixture.categoryId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      created_at: now,
      id: fixture.productId,
      name: `B102 Product ${fixture.productId}`,
      published_at: now,
      sales_count: 0,
      spu_code: `B102-SPU-${fixture.productId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B102-SKU-${fixture.skuId}`,
      created_at: now,
      id: fixture.skuId,
      name: 'B102 Payment SKU',
      product_id: fixture.productId,
      retail_price: new Prisma.Decimal('19.90'),
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  if (createBalance) {
    await transaction.inventoryBalance.create({
      data: {
        id: fixture.balanceId,
        locked_qty: primaryQuantity,
        physical_qty: primaryPhysicalQty,
        sku_id: fixture.skuId,
        updated_at: now,
        version: 1,
      },
    });
  }
  await transaction.salesOrder.create({
    data: {
      created_at: orderCreatedAt,
      customer_id: fixture.customerId,
      fulfillment_status: 'NOT_STARTED',
      goods_amount: primaryAmount,
      id: fixture.orderId,
      order_no: `QX${fixture.orderId}`,
      order_status: 'PENDING_PAYMENT',
      paid_amount: new Prisma.Decimal('0.00'),
      pay_expires_at: expiresAt,
      payable_amount: primaryAmount,
      payment_resolution: 'NORMAL',
      payment_status: paymentStatus,
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: new Prisma.Decimal('0.00'),
      shipping_amount: new Prisma.Decimal('0.00'),
      source: 'BUY_NOW',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: `B102 Brand ${fixture.brandId}`,
      category_id: fixture.categoryId,
      category_name_snapshot: `B102 Category ${fixture.categoryId}`,
      created_at: now,
      id: fixture.orderItemId,
      line_paid_amount: primaryAmount,
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: fixture.productId,
      product_name_snapshot: `B102 Product ${fixture.productId}`,
      quantity: primaryQuantity,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B102-SKU-${fixture.skuId}`,
      sku_id: fixture.skuId,
      sku_name_snapshot: 'B102 Payment SKU',
      unit_price: new Prisma.Decimal('19.90'),
      version: 1,
    },
  });
  await transaction.orderAddressSnapshot.create({
    data: {
      city: 'Auckland',
      created_at: now,
      detail_ciphertext: Buffer.from(`b102-detail-${fixture.orderId}`),
      district: 'Central',
      encryption_key_id: 'b102-order-key',
      id: fixture.addressId,
      order_id: fixture.orderId,
      phone_ciphertext: Buffer.from(`b102-address-phone-${fixture.orderId}`),
      phone_last4: '2468',
      province: 'Auckland',
      recipient_name: 'B10 Payment Recipient',
    },
  });
  await transaction.orderAttributionCandidate.create({
    data: {
      binding_id: agent?.bindingId ?? null,
      candidate_agent_id: agent?.agentId ?? null,
      id: fixture.attributionId,
      order_id: fixture.orderId,
      submit_channel: agent ? 'AGENT' : 'DIRECT',
      submitted_at: new Date(now.getTime() - 30_000),
    },
  });
  await transaction.inventoryReservation.create({
    data: {
      created_at: now,
      expires_at: expiresAt,
      id: fixture.reservationId,
      order_id: fixture.orderId,
      status: 'ACTIVE',
    },
  });
  await transaction.inventoryReservationItem.create({
    data: {
      created_at: now,
      id: fixture.reservationItemId,
      quantity: primaryQuantity,
      reservation_id: fixture.reservationId,
      sku_id: fixture.skuId,
    },
  });
  await transaction.inventoryLedger.create({
    data: {
      actor_account_id: fixture.accountId,
      business_id: fixture.reservationId,
      id: fixture.reserveLedgerId,
      ledger_type: 'ORDER_RESERVE',
      locked_after: primaryQuantity,
      locked_change: primaryQuantity,
      occurred_at: now,
      physical_after: primaryPhysicalQty,
      physical_change: 0,
      reason: 'ORDER_RESERVE',
      sku_id: fixture.skuId,
    },
  });
}

async function seedAdditionalSettlementLine(
  transaction: DatabaseTransaction,
  fixture: SettlementFixture,
  line: AdditionalSettlementLineFixture,
  now: Date,
  input: {
    createProduct: boolean;
    quantity: number;
    unitPrice: string;
  },
): Promise<void> {
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  if (input.createProduct) {
    await transaction.product.create({
      data: {
        brand_id: fixture.brandId,
        category_id: fixture.categoryId,
        created_at: now,
        id: line.productId,
        name: `B106 Product ${line.productId}`,
        published_at: now,
        sales_count: 0,
        spu_code: `B106-SPU-${line.productId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
  }
  await transaction.sku.create({
    data: {
      code: `B106-SKU-${line.skuId}`,
      created_at: now,
      id: line.skuId,
      name: `B106 Payment SKU ${line.skuId}`,
      product_id: line.productId,
      retail_price: unitPrice,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: line.balanceId,
      locked_qty: input.quantity,
      physical_qty: 7,
      sku_id: line.skuId,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: `B102 Brand ${fixture.brandId}`,
      category_id: fixture.categoryId,
      category_name_snapshot: `B102 Category ${fixture.categoryId}`,
      created_at: now,
      id: line.orderItemId,
      line_paid_amount: unitPrice.mul(input.quantity),
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: line.productId,
      product_name_snapshot: `B106 Product ${line.productId}`,
      quantity: input.quantity,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B106-SKU-${line.skuId}`,
      sku_id: line.skuId,
      sku_name_snapshot: `B106 Payment SKU ${line.skuId}`,
      unit_price: unitPrice,
      version: 1,
    },
  });
  await transaction.inventoryReservationItem.create({
    data: {
      created_at: now,
      id: line.reservationItemId,
      quantity: input.quantity,
      reservation_id: fixture.reservationId,
      sku_id: line.skuId,
    },
  });
  await transaction.inventoryLedger.create({
    data: {
      actor_account_id: fixture.accountId,
      business_id: fixture.reservationId,
      id: line.reserveLedgerId,
      ledger_type: 'ORDER_RESERVE',
      locked_after: input.quantity,
      locked_change: input.quantity,
      occurred_at: now,
      physical_after: 7,
      physical_change: 0,
      reason: 'ORDER_RESERVE',
      sku_id: line.skuId,
    },
  });
}

async function closeSettlementFixtureForLatePayment(
  transaction: DatabaseTransaction,
  fixture: SettlementFixture,
  paymentIntentId: string,
  closedAt: Date,
): Promise<void> {
  await transaction.paymentIntent.update({
    data: {
      close_requested_at: closedAt,
      closed_at: closedAt,
      next_reconcile_at: null,
      provider_state: 'CLOSED',
      status: 'CLOSED',
      version: { increment: 1 },
    },
    where: { id: paymentIntentId },
  });
  await transaction.inventoryBalance.update({
    data: { locked_qty: 0, version: { increment: 1 } },
    where: { id: fixture.balanceId },
  });
  await transaction.inventoryReservation.update({
    data: { released_at: closedAt, status: 'RELEASED' },
    where: { id: fixture.reservationId },
  });
  await transaction.inventoryLedger.create({
    data: {
      actor_account_id: fixture.accountId,
      business_id: fixture.reservationId,
      id: generateUlid(closedAt.getTime() - 1),
      ledger_type: 'ORDER_RELEASE',
      locked_after: 0,
      locked_change: -1,
      occurred_at: closedAt,
      physical_after: 5,
      physical_change: 0,
      reason: 'USER_CANCELLED',
      sku_id: fixture.skuId,
    },
  });
  await transaction.salesOrder.update({
    data: {
      close_reason: 'USER_CANCELLED',
      closed_at: closedAt,
      order_status: 'CLOSED',
      payment_status: 'UNPAID',
      version: { increment: 1 },
    },
    where: { id: fixture.orderId },
  });
}

async function openSettlementPayment(
  transaction: DatabaseTransaction,
  repository: StorePaymentRepository,
  fixture: SettlementFixture,
) {
  const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
    accountId: fixture.accountId,
    customerId: fixture.customerId,
    expectedVersion: 1,
    orderId: fixture.orderId,
    provider: 'MOCK',
    reconcileAfterMs: 30_000,
  });
  const paymentIntentId = prepared.intent.paymentIntentId;
  const providerIntentId = `mock-${paymentIntentId}`;
  const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
    expectedVersion: 1,
    orderId: fixture.orderId,
    paymentIntentId,
    provider: 'MOCK',
    result: {
      kind: 'OPEN',
      nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
      providerIntentId,
      providerState: 'OPEN',
    },
  });
  return { opened, paymentIntentId, providerIntentId };
}

databaseDescribe('B10 Store payment database integration', () => {
  let runtime: DatabaseRuntime;
  const repository = new StorePaymentRepository();

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    await runtime?.disconnect();
  });

  it('refuses to create a payment intent for an empty order and rolls every fixture back', async () => {
    const now = new Date();
    const accountId = generateUlid(now.getTime() - 5_000);
    const customerId = generateUlid(now.getTime() - 4_000);
    const orderId = generateUlid(now.getTime() - 3_000);
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: {
          created_at: now,
          id: accountId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          updated_at: now,
          version: 1,
          wechat_open_id: `b10-payment-${accountId}`,
        },
      });
      await transaction.customerProfile.create({
        data: {
          account_id: accountId,
          created_at: now,
          id: customerId,
          registered_at: now,
          updated_at: now,
          version: 1,
        },
      });
      const expiresAt = new Date(now.getTime() + 30 * 60_000);
      await transaction.salesOrder.create({
        data: {
          created_at: now,
          customer_id: customerId,
          fulfillment_status: 'NOT_STARTED',
          goods_amount: new Prisma.Decimal('19.90'),
          id: orderId,
          order_no: `QX${orderId}`,
          order_status: 'PENDING_PAYMENT',
          paid_amount: new Prisma.Decimal('0.00'),
          pay_expires_at: expiresAt,
          payable_amount: new Prisma.Decimal('19.90'),
          payment_resolution: 'NORMAL',
          payment_status: 'UNPAID',
          refund_processing_status: 'IDLE',
          refund_progress_status: 'NONE',
          refunded_amount: new Prisma.Decimal('0.00'),
          shipping_amount: new Prisma.Decimal('0.00'),
          source: 'BUY_NOW',
          updated_at: now,
          version: 1,
        },
      });
      await transaction.inventoryReservation.create({
        data: {
          created_at: now,
          expires_at: expiresAt,
          id: generateUlid(now.getTime() - 2_000),
          order_id: orderId,
          status: 'ACTIVE',
        },
      });

      await expect(repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId,
        customerId,
        expectedVersion: 1,
        orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      })).rejects.toMatchObject({ code: 'PAYMENT_NOT_ALLOWED' });
      await expect(transaction.paymentIntent.count({ where: { order_id: orderId } })).resolves.toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.paymentIntent.count({ where: { order_id: orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.account.count({ where: { id: accountId } })).resolves.toBe(0);
  }, 120_000);

  it('settles a direct successful payment exactly once and rolls inventory and payment facts back', async () => {
    const now = new Date();
    const accountId = generateUlid(now.getTime() - 12_000);
    const customerId = generateUlid(now.getTime() - 11_000);
    const brandId = generateUlid(now.getTime() - 10_000);
    const categoryId = generateUlid(now.getTime() - 9_000);
    const productId = generateUlid(now.getTime() - 8_000);
    const skuId = generateUlid(now.getTime() - 7_000);
    const balanceId = generateUlid(now.getTime() - 6_000);
    const orderId = generateUlid(now.getTime() - 5_000);
    const orderItemId = generateUlid(now.getTime() - 4_000);
    const reservationId = generateUlid(now.getTime() - 3_000);
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: {
          created_at: now,
          id: accountId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          updated_at: now,
          version: 1,
          wechat_open_id: `b102-payment-${accountId}`,
        },
      });
      await transaction.customerProfile.create({
        data: {
          account_id: accountId,
          created_at: now,
          id: customerId,
          nickname: 'B10 Payment Customer',
          registered_at: now,
          updated_at: now,
          version: 1,
        },
      });
      await transaction.brand.create({
        data: { created_at: now, id: brandId, name: `B102 Brand ${brandId}`, status: 'ACTIVE', updated_at: now },
      });
      await transaction.category.create({
        data: {
          created_at: now,
          id: categoryId,
          name: `B102 Category ${categoryId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.product.create({
        data: {
          brand_id: brandId,
          category_id: categoryId,
          created_at: now,
          id: productId,
          name: `B102 Product ${productId}`,
          published_at: now,
          sales_count: 0,
          spu_code: `B102-SPU-${productId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.sku.create({
        data: {
          code: `B102-SKU-${skuId}`,
          created_at: now,
          id: skuId,
          name: 'B102 Payment SKU',
          product_id: productId,
          retail_price: new Prisma.Decimal('19.90'),
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.inventoryBalance.create({
        data: {
          id: balanceId,
          locked_qty: 1,
          physical_qty: 5,
          sku_id: skuId,
          updated_at: now,
          version: 1,
        },
      });
      const expiresAt = new Date(now.getTime() + 30 * 60_000);
      await transaction.salesOrder.create({
        data: {
          created_at: now,
          customer_id: customerId,
          fulfillment_status: 'NOT_STARTED',
          goods_amount: new Prisma.Decimal('19.90'),
          id: orderId,
          order_no: `QX${orderId}`,
          order_status: 'PENDING_PAYMENT',
          paid_amount: new Prisma.Decimal('0.00'),
          pay_expires_at: expiresAt,
          payable_amount: new Prisma.Decimal('19.90'),
          payment_resolution: 'NORMAL',
          payment_status: 'UNPAID',
          refund_processing_status: 'IDLE',
          refund_progress_status: 'NONE',
          refunded_amount: new Prisma.Decimal('0.00'),
          shipping_amount: new Prisma.Decimal('0.00'),
          source: 'BUY_NOW',
          updated_at: now,
          version: 1,
        },
      });
      await transaction.orderItem.create({
        data: {
          aftersale_reserved_amount: new Prisma.Decimal(0),
          aftersale_reserved_qty: 0,
          brand_name_snapshot: `B102 Brand ${brandId}`,
          category_id: categoryId,
          category_name_snapshot: `B102 Category ${categoryId}`,
          created_at: now,
          id: orderItemId,
          line_paid_amount: new Prisma.Decimal('19.90'),
          order_id: orderId,
          pre_shipment_refunded_qty: 0,
          product_id: productId,
          product_name_snapshot: `B102 Product ${productId}`,
          quantity: 1,
          refunded_amount: new Prisma.Decimal(0),
          refunded_qty: 0,
          shipped_qty: 0,
          sku_code_snapshot: `B102-SKU-${skuId}`,
          sku_id: skuId,
          sku_name_snapshot: 'B102 Payment SKU',
          unit_price: new Prisma.Decimal('19.90'),
          version: 1,
        },
      });
      await transaction.orderAddressSnapshot.create({
        data: {
          city: 'Auckland',
          created_at: now,
          detail_ciphertext: Buffer.from(`b102-detail-${orderId}`),
          district: 'Central',
          encryption_key_id: 'b102-order-key',
          id: generateUlid(now.getTime() - 2_900),
          order_id: orderId,
          phone_ciphertext: Buffer.from(`b102-phone-${orderId}`),
          phone_last4: '2468',
          province: 'Auckland',
          recipient_name: 'B10 Payment Recipient',
        },
      });
      await transaction.orderAttributionCandidate.create({
        data: {
          id: generateUlid(now.getTime() - 2_800),
          order_id: orderId,
          submit_channel: 'DIRECT',
          submitted_at: now,
        },
      });
      await transaction.inventoryReservation.create({
        data: {
          created_at: now,
          expires_at: expiresAt,
          id: reservationId,
          order_id: orderId,
          status: 'ACTIVE',
        },
      });
      await transaction.inventoryReservationItem.create({
        data: {
          created_at: now,
          id: generateUlid(now.getTime() - 2_700),
          quantity: 1,
          reservation_id: reservationId,
          sku_id: skuId,
        },
      });
      await transaction.inventoryLedger.create({
        data: {
          actor_account_id: accountId,
          business_id: reservationId,
          id: generateUlid(now.getTime() - 2_600),
          ledger_type: 'ORDER_RESERVE',
          locked_after: 1,
          locked_change: 1,
          occurred_at: now,
          physical_after: 5,
          physical_change: 0,
          reason: 'ORDER_RESERVE',
          sku_id: skuId,
        },
      });

      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId,
        customerId,
        expectedVersion: 1,
        orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      const providerIntentId = `mock-${paymentIntentId}`;
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
          providerIntentId,
          providerState: 'OPEN',
        },
      });
      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: opened.intent.serverTime,
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `mock-transaction-${paymentIntentId}`,
      };
      const settled = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(settled).toMatchObject({
        changed: true,
        commissionLedgerIds: [],
        commissionSnapshotIds: [],
        finalAgentId: null,
        finalChannel: 'DIRECT',
        kind: 'SETTLED',
        reservationId,
      });
      await expect(repository.applyPaymentCallbackInTransaction(transaction, callbackInput))
        .resolves.toMatchObject({ changed: false, kind: 'REPLAY' });
      await expect(transaction.salesOrder.findUnique({ where: { id: orderId } })).resolves.toMatchObject({
        fulfillment_status: 'READY_TO_SHIP',
        order_status: 'PENDING_SHIPMENT',
        paid_amount: new Prisma.Decimal('19.90'),
        payment_resolution: 'NORMAL',
        payment_status: 'PAID',
        version: 3,
      });
      await expect(transaction.inventoryReservation.findUnique({ where: { id: reservationId } }))
        .resolves.toMatchObject({ status: 'CONSUMED' });
      await expect(transaction.inventoryBalance.findUnique({ where: { id: balanceId } }))
        .resolves.toMatchObject({ locked_qty: 0, physical_qty: 4, version: 2 });
      await expect(transaction.product.findUnique({ where: { id: productId } }))
        .resolves.toMatchObject({ sales_count: 1 });
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(1);
      await expect(transaction.inventoryLedger.count({
        where: { business_id: reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.product.count({ where: { id: productId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
  }, 120_000);

  it('aggregates two SKU quantities into one product sales counter and rolls every fact back', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    const secondLine = additionalSettlementLineFixture(now, fixture.productId);
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedSettlementFixture(transaction, fixture, now, {
        primaryPhysicalQty: 7,
        primaryQuantity: 2,
      });
      await seedAdditionalSettlementLine(transaction, fixture, secondLine, now, {
        createProduct: false,
        quantity: 3,
        unitPrice: '10.00',
      });
      await transaction.salesOrder.update({
        data: {
          goods_amount: new Prisma.Decimal('69.80'),
          payable_amount: new Prisma.Decimal('69.80'),
          source: 'CART',
        },
        where: { id: fixture.orderId },
      });
      const opened = await openSettlementPayment(transaction, repository, fixture);
      paymentIntentId = opened.paymentIntentId;
      const callbackInput = {
        amount: '69.80',
        eventType: 'payment.succeeded' as const,
        occurredAt: opened.opened.intent.serverTime,
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-aggregate-${opened.paymentIntentId}`,
        providerIntentId: opened.providerIntentId,
        providerTransactionId: `mock-transaction-${opened.paymentIntentId}`,
      };

      await expect(repository.applyPaymentCallbackInTransaction(transaction, callbackInput))
        .resolves.toMatchObject({ changed: true, kind: 'SETTLED' });
      await expect(repository.applyPaymentCallbackInTransaction(transaction, callbackInput))
        .resolves.toMatchObject({ changed: false, kind: 'REPLAY' });
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 5 });
      await expect(transaction.inventoryBalance.findMany({
        orderBy: { sku_id: 'asc' },
        where: { id: { in: [fixture.balanceId, secondLine.balanceId] } },
      })).resolves.toEqual([
        expect.objectContaining({ locked_qty: 0, physical_qty: 5 }),
        expect.objectContaining({ locked_qty: 0, physical_qty: 4 }),
      ]);
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(2);
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.product.count({ where: { id: fixture.productId } })).resolves.toBe(0);
    await expect(runtime.prisma.sku.count({ where: { id: { in: [fixture.skuId, secondLine.skuId] } } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.inventoryLedger.count({ where: { business_id: fixture.reservationId } }))
      .resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
      await expect(runtime.prisma.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(0);
    }
  }, 120_000);

  it('rolls back the first product sales update when the second product CAS loses its row', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    const secondLine = additionalSettlementLineFixture(now);
    const commissionFixture = agentCommissionFixture(now);
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedActiveAgentWithPublishedCommission(transaction, commissionFixture, now, '10.0000');
      await seedSettlementFixture(transaction, fixture, now, {
        agent: {
          agentId: commissionFixture.agentId,
          bindingId: commissionFixture.bindingId,
        },
      });
      await seedAdditionalSettlementLine(transaction, fixture, secondLine, now, {
        createProduct: true,
        quantity: 2,
        unitPrice: '10.00',
      });
      await transaction.salesOrder.update({
        data: {
          goods_amount: new Prisma.Decimal('39.90'),
          payable_amount: new Prisma.Decimal('39.90'),
          source: 'CART',
        },
        where: { id: fixture.orderId },
      });
      const opened = await openSettlementPayment(transaction, repository, fixture);
      paymentIntentId = opened.paymentIntentId;
      await expect(transaction.commissionRuleEntry.findUnique({
        where: { id: commissionFixture.ruleEntryId },
      })).resolves.toMatchObject({ configured_rate: new Prisma.Decimal('10.0000') });
      await expect(transaction.orderAttributionCandidate.findUnique({
        where: { order_id: fixture.orderId },
      })).resolves.toMatchObject({
        binding_id: commissionFixture.bindingId,
        candidate_agent_id: commissionFixture.agentId,
        finalization_result: null,
        submit_channel: 'AGENT',
      });
      await transaction.$executeRawUnsafe('SAVEPOINT b10_qa005_settlement');

      const productDelegate = transaction.product;
      let salesUpdateCount = 0;
      const failingProductDelegate = new Proxy(productDelegate, {
        get(target, property) {
          if (property === 'updateMany') {
            return async (args: Parameters<typeof productDelegate.updateMany>[0]) => {
              salesUpdateCount += 1;
              if (salesUpdateCount === 2) return { count: 0 };
              return productDelegate.updateMany(args);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const failingTransaction = new Proxy(transaction, {
        get(target, property) {
          if (property === 'product') return failingProductDelegate;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as unknown as DatabaseTransaction;
      const callbackInput = {
        amount: '39.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: opened.opened.intent.serverTime,
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-cas-${opened.paymentIntentId}`,
        providerIntentId: opened.providerIntentId,
        providerTransactionId: `mock-transaction-${opened.paymentIntentId}`,
      };

      await expect(repository.applyPaymentCallbackInTransaction(failingTransaction, callbackInput))
        .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(salesUpdateCount).toBe(2);
      await expect(transaction.product.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, sales_count: true },
        where: { id: { in: [fixture.productId, secondLine.productId] } },
      })).resolves.toEqual([
        { id: fixture.productId, sales_count: 1 },
        { id: secondLine.productId, sales_count: 0 },
      ]);

      await transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT b10_qa005_settlement');
      await expect(transaction.product.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, sales_count: true },
        where: { id: { in: [fixture.productId, secondLine.productId] } },
      })).resolves.toEqual([
        { id: fixture.productId, sales_count: 0 },
        { id: secondLine.productId, sales_count: 0 },
      ]);
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(0);
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(0);
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ status: 'ACTIVE' });
      await expect(transaction.inventoryBalance.findMany({
        orderBy: { sku_id: 'asc' },
        where: { id: { in: [fixture.balanceId, secondLine.balanceId] } },
      })).resolves.toEqual([
        expect.objectContaining({ locked_qty: 1, physical_qty: 5 }),
        expect.objectContaining({ locked_qty: 2, physical_qty: 7 }),
      ]);
      await expect(transaction.orderItemCommissionSnapshot.count({
        where: { order_item_id: { in: [fixture.orderItemId, secondLine.orderItemId] } },
      })).resolves.toBe(0);
      await expect(transaction.orderAttributionSnapshot.count({ where: { order_id: fixture.orderId } }))
        .resolves.toBe(0);
      await expect(transaction.agentCustomerPrivacyProjection.count({
        where: { agent_id: commissionFixture.agentId, customer_id: fixture.customerId },
      })).resolves.toBe(0);
      await expect(transaction.commissionLedger.count({ where: { agent_id: commissionFixture.agentId } }))
        .resolves.toBe(0);
      await expect(transaction.orderAttributionCandidate.findUnique({
        where: { order_id: fixture.orderId },
      })).resolves.toMatchObject({ finalization_result: null, finalized_at: null });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.product.count({
      where: { id: { in: [fixture.productId, secondLine.productId] } },
    })).resolves.toBe(0);
    await expect(runtime.prisma.inventoryBalance.count({
      where: { id: { in: [fixture.balanceId, secondLine.balanceId] } },
    })).resolves.toBe(0);
    await expect(runtime.prisma.inventoryLedger.count({ where: { business_id: fixture.reservationId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.agentProfile.count({ where: { id: commissionFixture.agentId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.commissionRuleVersion.count({ where: { id: commissionFixture.ruleVersionId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.commissionLedger.count({ where: { agent_id: commissionFixture.agentId } }))
      .resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
      await expect(runtime.prisma.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(0);
    }
  }, 120_000);

  it.each([
    {
      commission: '1.99',
      label: 'positive',
      ledgerCount: 1,
      positionState: 'EXPECTED',
      rate: '10.0000',
    },
    {
      commission: '0.00',
      label: 'zero-percent',
      ledgerCount: 0,
      positionState: 'NONE',
      rate: '0.0000',
    },
  ] as const)('settles an attributed payment with $label immutable commission under mall_runtime', async ({
    commission: expectedCommission,
    ledgerCount,
    positionState,
    rate,
  }) => {
    const now = new Date();
    const fixture = settlementFixture(now);
    const commissionFixture = agentCommissionFixture(now);
    const {
      agentId,
      bindingId,
      ruleVersionId,
    } = commissionFixture;
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedActiveAgentWithPublishedCommission(transaction, commissionFixture, now, rate);
      await seedSettlementFixture(transaction, fixture, now, { agent: { agentId, bindingId } });

      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        expectedVersion: 1,
        orderId: fixture.orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      const providerIntentId = `mock-${paymentIntentId}`;
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId: fixture.orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
          providerIntentId,
          providerState: 'OPEN',
        },
      });
      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: opened.intent.serverTime,
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `mock-transaction-${paymentIntentId}`,
      };
      const settled = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(settled).toMatchObject({
        changed: true,
        finalAgentId: agentId,
        finalChannel: 'AGENT',
        kind: 'SETTLED',
        reservationId: fixture.reservationId,
      });
      expect(settled.commissionSnapshotIds).toHaveLength(1);
      expect(settled.commissionLedgerIds).toHaveLength(ledgerCount);

      const attribution = await transaction.orderAttributionSnapshot.findUniqueOrThrow({
        where: { order_id: fixture.orderId },
      });
      expect(attribution).toMatchObject({
        agent_id_snapshot: agentId,
        binding_id_snapshot: bindingId,
        final_channel: 'AGENT',
      });
      const privacy = await transaction.agentCustomerPrivacyProjection.findUniqueOrThrow({
        where: { attribution_snapshot_id: attribution.id },
      });
      expect(privacy).toMatchObject({
        agent_id: agentId,
        anonymized_at: null,
        city: 'Auckland',
        customer_id: fixture.customerId,
        nickname_masked: 'F**',
        phone_tail: '4826',
      });
      expect(privacy.customer_alias).toMatch(/^customer_[0-9a-z]{26}$/);
      expect(privacy.customer_alias).not.toContain(fixture.customerId.toLowerCase());

      const commission = await transaction.orderItemCommissionSnapshot.findUniqueOrThrow({
        where: { order_item_id: fixture.orderItemId },
      });
      expect(commission).toMatchObject({
        agent_id: agentId,
        category_id_snapshot: fixture.categoryId,
        category_name_snapshot: `B102 Category ${fixture.categoryId}`,
        product_id_snapshot: fixture.productId,
        rule_version_id: ruleVersionId,
        sku_id_snapshot: fixture.skuId,
        source_type: 'PLATFORM',
      });
      expect(commission.effective_rate.toFixed(4)).toBe(rate);
      expect(commission.commission_base.toFixed(2)).toBe('19.90');
      expect(commission.original_commission.toFixed(2)).toBe(expectedCommission);
      await expect(transaction.orderItemCommissionPosition.findUnique({
        where: { snapshot_id: commission.id },
      })).resolves.toMatchObject({
        expected_remaining: new Prisma.Decimal(expectedCommission),
        original_commission: new Prisma.Decimal(expectedCommission),
        reversed_total: new Prisma.Decimal('0.00'),
        state: positionState,
        version: 1,
      });
      const commissionLedgers = await transaction.commissionLedger.findMany({
        where: { agent_id: agentId, snapshot_id: commission.id },
      });
      expect(commissionLedgers).toHaveLength(ledgerCount);
      if (ledgerCount === 1) {
        expect(commissionLedgers[0]).toEqual(expect.objectContaining({
          available_change: new Prisma.Decimal('0.00'),
          expected_change: new Prisma.Decimal(expectedCommission),
          frozen_change: new Prisma.Decimal('0.00'),
          ledger_type: 'EXPECTED_CREATED',
          reason: 'ORDER_PAID',
        }));
      }
      await expect(transaction.orderAttributionCandidate.findUnique({
        where: { order_id: fixture.orderId },
      })).resolves.toMatchObject({ finalization_result: 'AGENT_CONFIRMED' });
      await expect(transaction.inventoryBalance.findUnique({
        where: { id: fixture.balanceId },
      })).resolves.toMatchObject({ locked_qty: 0, physical_qty: 4, version: 2 });
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 1 });
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(1);
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: fixture.orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.agentProfile.count({ where: { id: agentId } })).resolves.toBe(0);
    await expect(runtime.prisma.customerAgentBinding.count({ where: { id: bindingId } })).resolves.toBe(0);
    await expect(runtime.prisma.product.count({ where: { id: fixture.productId } })).resolves.toBe(0);
    await expect(runtime.prisma.commissionRuleVersion.count({ where: { id: ruleVersionId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
  }, 120_000);

  it('repairs a manual settlement without duplicating its success attempt or sales counter', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedSettlementFixture(transaction, fixture, now, { createBalance: false });
      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        expectedVersion: 1,
        orderId: fixture.orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      const providerIntentId = `mock-${paymentIntentId}`;
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId: fixture.orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
          providerIntentId,
          providerState: 'OPEN',
        },
      });
      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: opened.intent.serverTime,
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `mock-transaction-${paymentIntentId}`,
      };
      const manual = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(manual).toMatchObject({
        after: {
          intentStatus: 'SUCCEEDED',
          orderPaymentResolution: 'MANUAL_REQUIRED',
          orderPaymentStatus: 'PAID',
          orderStatus: 'PENDING_PAYMENT',
        },
        changed: true,
        kind: 'MANUAL_REQUIRED',
      });
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(1);
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 0 });
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(0);
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ consumed_at: null, status: 'ACTIVE' });

      await transaction.inventoryBalance.create({
        data: {
          id: fixture.balanceId,
          locked_qty: 1,
          physical_qty: 5,
          sku_id: fixture.skuId,
          updated_at: now,
          version: 1,
        },
      });
      const compensated = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(compensated).toMatchObject({
        after: {
          intentStatus: 'SUCCEEDED',
          orderPaymentResolution: 'NORMAL',
          orderPaymentStatus: 'PAID',
          orderStatus: 'PENDING_SHIPMENT',
        },
        changed: true,
        kind: 'SETTLED',
        paymentAttemptId: manual.paymentAttemptId,
      });
      await expect(repository.applyPaymentCallbackInTransaction(transaction, callbackInput))
        .resolves.toMatchObject({ changed: false, kind: 'REPLAY', paymentAttemptId: manual.paymentAttemptId });
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(1);
      await expect(transaction.paymentIntent.findUnique({ where: { id: paymentIntentId } }))
        .resolves.toMatchObject({ status: 'SUCCEEDED', version: 3 });
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 1 });
      await expect(transaction.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 0, physical_qty: 4, version: 2 });
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ status: 'CONSUMED' });
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(1);
      await expect(transaction.orderAttributionSnapshot.count({ where: { order_id: fixture.orderId } }))
        .resolves.toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: fixture.orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.inventoryLedger.count({ where: { business_id: fixture.reservationId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.product.count({ where: { id: fixture.productId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(0);
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
  }, 120_000);

  it('closes an expired Provider intent, exposes reconciliation, and refunds a PAYMENT_TIMEOUT late success', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    const orderRepository = new StoreOrderRepository();
    let paymentIntentId: string | undefined;
    let refundId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      const expiredAt = new Date(now.getTime() - 60_000);
      await seedSettlementFixture(transaction, fixture, now, {
        expiresAt: expiredAt,
        paymentStatus: 'PROCESSING',
      });
      paymentIntentId = generateUlid(now.getTime() - 500);
      const opened = {
        paymentIntentId,
        providerIntentId: `mock-${paymentIntentId}`,
      };
      await transaction.paymentIntent.create({
        data: {
          amount: new Prisma.Decimal('19.90'),
          create_requested_at: new Date(now.getTime() - 120_000),
          expires_at: expiredAt,
          id: paymentIntentId,
          intent_no: `PI${paymentIntentId}`,
          next_reconcile_at: now,
          opened_at: new Date(now.getTime() - 90_000),
          order_id: fixture.orderId,
          provider: 'MOCK',
          provider_intent_id: opened.providerIntentId,
          provider_state: 'OPEN',
          status: 'OPEN',
          updated_at: now,
          version: 1,
        },
      });

      const claimed = await orderRepository.claimOrderCloseInTransaction(transaction, {
        mode: 'PAYMENT_TIMEOUT',
        orderId: fixture.orderId,
      });
      expect(claimed).toMatchObject({
        changed: true,
        kind: 'PROVIDER_REQUIRED',
        mode: 'PAYMENT_TIMEOUT',
        providerOperation: 'CLOSE',
      });
      if (claimed.paymentIntent === null) throw new Error('Timeout payment intent claim is missing');

      const reconciliation = reconciliationRepositoryForTransaction(transaction);
      await expect(findReconciliationTask(reconciliation, {
        intentStatus: 'CLOSE_PENDING',
        taskType: 'PAYMENT_INTENT',
      }, (task) => task.paymentIntentId === opened.paymentIntentId)).resolves.toMatchObject({
        orderId: fixture.orderId,
        paymentIntentId: opened.paymentIntentId,
        status: 'CLOSE_PENDING',
        taskType: 'PAYMENT_INTENT',
      });
      await expect(reconciliation.readActionFacts(opened.paymentIntentId)).resolves.toMatchObject({
        kind: 'PAYMENT_INTENT',
        orderId: fixture.orderId,
        status: 'CLOSE_PENDING',
      });

      const closed = await orderRepository.finalizeOrderCloseInTransaction(transaction, {
        expectedIntentVersion: claimed.paymentIntent.version,
        orderId: fixture.orderId,
        outcome: 'CLOSED',
        paymentIntentId: opened.paymentIntentId,
        providerIntentId: opened.providerIntentId,
        providerState: 'CLOSED',
      });
      expect(closed).toMatchObject({
        kind: 'CLOSED',
        order: {
          closeReason: 'PAYMENT_TIMEOUT',
          orderStatus: 'CLOSED',
          paymentStatus: 'UNPAID',
        },
      });
      await expect(reconciliation.findCurrentByPaymentIntentId(opened.paymentIntentId))
        .resolves.toMatchObject({
          kind: 'CONVERGED',
          projection: {
            orderId: fixture.orderId,
            outcome: 'CONVERGED',
            paymentIntentStatus: 'CLOSED',
            paymentResolution: 'NORMAL',
          },
        });

      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: new Date(closed.order.serverTime.getTime() + 1_000),
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-timeout-${opened.paymentIntentId}`,
        providerIntentId: opened.providerIntentId,
        providerTransactionId: `mock-transaction-${opened.paymentIntentId}`,
      };
      const late = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(late).toMatchObject({
        after: {
          orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
          orderPaymentStatus: 'PAID',
          orderStatus: 'CLOSED',
        },
        changed: true,
        kind: 'LATE_REFUND_REQUIRED',
      });
      if (late.lateRefund === null) throw new Error('Timeout late refund operation is missing');
      refundId = late.lateRefund.refundId;
      await expect(findReconciliationTask(reconciliation, {
        refundStatus: 'PENDING',
        taskType: 'LATE_PAYMENT_REFUND',
      }, (task) => task.paymentIntentId === opened.paymentIntentId &&
        task.refundId === refundId)).resolves.toMatchObject({
        orderId: fixture.orderId,
        paymentIntentId: opened.paymentIntentId,
        refundId,
        status: 'PENDING',
        taskType: 'LATE_PAYMENT_REFUND',
      });
      await expect(reconciliation.readActionFacts(opened.paymentIntentId)).resolves.toMatchObject({
        kind: 'LATE_PAYMENT_REFUND',
        lateRefundOperation: expect.objectContaining({ refundId }),
        orderId: fixture.orderId,
        refundId,
        refundStatus: 'PENDING',
      });

      const refundClaim = await repository.claimLatePaymentRefundInTransaction(transaction, late.lateRefund);
      expect(refundClaim.kind).toBe('CLAIMED');
      if (refundClaim.kind !== 'CLAIMED') throw new Error('Timeout late refund was not claimed');
      await expect(repository.finalizeLatePaymentRefundInTransaction(transaction, {
        operation: refundClaim.operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(closed.order.serverTime.getTime() + 2_000),
          providerEventId: `mock-refund-event-${refundId}`,
          providerRefundId: `mock-refund-${refundId}`,
        },
      })).resolves.toMatchObject({ changed: true, kind: 'REFUNDED' });
      await expect(reconciliation.findCurrentByPaymentIntentId(opened.paymentIntentId))
        .resolves.toMatchObject({
          kind: 'CONVERGED',
          projection: {
            orderId: fixture.orderId,
            paymentIntentStatus: 'SUCCEEDED',
            paymentResolution: 'LATE_SUCCESS_REFUNDED',
            refundId,
            refundStatus: 'SUCCEEDED',
          },
        });

      await expect(transaction.salesOrder.findUnique({ where: { id: fixture.orderId } })).resolves.toMatchObject({
        close_reason: 'PAYMENT_TIMEOUT',
        order_status: 'CLOSED',
        payment_resolution: 'LATE_SUCCESS_REFUNDED',
        payment_status: 'PAID',
      });
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ consumed_at: null, status: 'EXPIRED' });
      await expect(transaction.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 0, physical_qty: 5 });
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_RELEASE' },
      })).resolves.toBe(1);
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(0);
      await expect(transaction.paymentAttempt.count({ where: { payment_intent_id: opened.paymentIntentId } }))
        .resolves.toBe(1);
      await expect(transaction.refund.count({
        where: { order_id: fixture.orderId, origin_type: 'LATE_PAYMENT' },
      })).resolves.toBe(1);
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 0 });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: fixture.orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.inventoryReservation.count({ where: { id: fixture.reservationId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.inventoryLedger.count({ where: { business_id: fixture.reservationId } }))
      .resolves.toBe(0);
    await expect(runtime.prisma.product.count({ where: { id: fixture.productId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
      await expect(runtime.prisma.paymentAttempt.count({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toBe(0);
    }
    if (refundId !== undefined) {
      await expect(runtime.prisma.refund.count({ where: { id: refundId } })).resolves.toBe(0);
      await expect(runtime.prisma.refundAttempt.count({ where: { refund_id: refundId } })).resolves.toBe(0);
    }
  }, 120_000);

  it('refunds a late success once while preserving the closed order and released inventory', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    let paymentIntentId: string | undefined;
    let refundId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedSettlementFixture(transaction, fixture, now);
      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        expectedVersion: 1,
        orderId: fixture.orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      const providerIntentId = `mock-${paymentIntentId}`;
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId: fixture.orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
          providerIntentId,
          providerState: 'OPEN',
        },
      });
      const closedAt = opened.intent.serverTime;
      await closeSettlementFixtureForLatePayment(transaction, fixture, paymentIntentId, closedAt);

      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: new Date(closedAt.getTime() + 1_000),
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `mock-transaction-${paymentIntentId}`,
      };
      const late = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(late).toMatchObject({
        after: {
          orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
          orderPaymentStatus: 'PAID',
          orderStatus: 'CLOSED',
        },
        changed: true,
        kind: 'LATE_REFUND_REQUIRED',
      });
      if (late.lateRefund === null) throw new Error('Late refund operation is missing');
      refundId = late.lateRefund.refundId;
      const claimed = await repository.claimLatePaymentRefundInTransaction(transaction, late.lateRefund);
      expect(claimed.kind).toBe('CLAIMED');
      if (claimed.kind !== 'CLAIMED') throw new Error('Late refund was not claimed');
      await expect(repository.finalizeLatePaymentRefundInTransaction(transaction, {
        operation: claimed.operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date(closedAt.getTime() + 2_000),
          providerEventId: `mock-refund-event-${refundId}`,
          providerRefundId: `mock-refund-${refundId}`,
        },
      })).resolves.toMatchObject({ changed: true, kind: 'REFUNDED' });
      await expect(repository.applyPaymentCallbackInTransaction(transaction, {
        ...callbackInput,
        occurredAt: new Date(callbackInput.occurredAt.getTime() + 5_000),
        providerEventId: `${callbackInput.providerEventId}-retry`,
      }))
        .resolves.toMatchObject({ changed: false, kind: 'REPLAY', paymentAttemptId: late.paymentAttemptId });

      await expect(transaction.salesOrder.findUnique({ where: { id: fixture.orderId } })).resolves.toMatchObject({
        close_reason: 'USER_CANCELLED',
        fulfillment_status: 'NOT_STARTED',
        order_status: 'CLOSED',
        paid_amount: new Prisma.Decimal('19.90'),
        payment_resolution: 'LATE_SUCCESS_REFUNDED',
        payment_status: 'PAID',
        refunded_amount: new Prisma.Decimal('19.90'),
        refund_processing_status: 'IDLE',
        refund_progress_status: 'FULL',
      });
      await expect(transaction.orderItem.findUnique({ where: { id: fixture.orderItemId } })).resolves.toMatchObject({
        pre_shipment_refunded_qty: 1,
        refunded_amount: new Prisma.Decimal('19.90'),
        refunded_qty: 1,
        shipped_qty: 0,
      });
      await expect(transaction.refund.count({
        where: { order_id: fixture.orderId, origin_type: 'LATE_PAYMENT' },
      })).resolves.toBe(1);
      await expect(transaction.refundAttempt.count({ where: { refund_id: refundId } })).resolves.toBe(1);
      await expect(transaction.paymentAttempt.findMany({ where: { payment_intent_id: paymentIntentId } }))
        .resolves.toEqual([expect.objectContaining({ status: 'SUCCEEDED_LATE' })]);
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ consumed_at: null, status: 'RELEASED' });
      await expect(transaction.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 0, physical_qty: 5 });
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(0);
      await expect(transaction.orderAttributionSnapshot.count({ where: { order_id: fixture.orderId } }))
        .resolves.toBe(0);
      await expect(transaction.orderItemCommissionSnapshot.count({
        where: { order_item_id: fixture.orderItemId },
      })).resolves.toBe(0);
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 0 });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: fixture.orderId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
    if (refundId !== undefined) {
      await expect(runtime.prisma.refund.count({ where: { id: refundId } })).resolves.toBe(0);
    }
  }, 120_000);

  it('routes a failed late-payment refund to manual review without restoring inventory or commission', async () => {
    const now = new Date();
    const fixture = settlementFixture(now);
    let paymentIntentId: string | undefined;
    let refundId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedSettlementFixture(transaction, fixture, now);
      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        expectedVersion: 1,
        orderId: fixture.orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      const providerIntentId = `mock-${paymentIntentId}`;
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId: fixture.orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
          providerIntentId,
          providerState: 'OPEN',
        },
      });
      const closedAt = opened.intent.serverTime;
      await closeSettlementFixtureForLatePayment(transaction, fixture, paymentIntentId, closedAt);
      const callbackInput = {
        amount: '19.90',
        eventType: 'payment.succeeded' as const,
        occurredAt: new Date(closedAt.getTime() + 1_000),
        outcome: 'SUCCEEDED' as const,
        provider: 'MOCK' as const,
        providerEventId: `mock-event-failed-refund-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `mock-transaction-${paymentIntentId}`,
      };
      const late = await repository.applyPaymentCallbackInTransaction(transaction, callbackInput);
      expect(late.kind).toBe('LATE_REFUND_REQUIRED');
      if (late.lateRefund === null) throw new Error('Late refund operation is missing');
      refundId = late.lateRefund.refundId;
      const claimed = await repository.claimLatePaymentRefundInTransaction(transaction, late.lateRefund);
      expect(claimed.kind).toBe('CLAIMED');
      if (claimed.kind !== 'CLAIMED') throw new Error('Late refund was not claimed');
      await expect(repository.finalizeLatePaymentRefundInTransaction(transaction, {
        operation: claimed.operation,
        result: { failureCode: 'PROVIDER_UNAVAILABLE', kind: 'FAILED', occurredAt: null },
      })).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
      await expect(repository.applyPaymentCallbackInTransaction(transaction, {
        ...callbackInput,
        occurredAt: new Date(callbackInput.occurredAt.getTime() + 5_000),
        providerEventId: `${callbackInput.providerEventId}-retry`,
      })).resolves.toMatchObject({ changed: false, kind: 'REPLAY', paymentAttemptId: late.paymentAttemptId });

      await expect(transaction.salesOrder.findUnique({ where: { id: fixture.orderId } })).resolves.toMatchObject({
        fulfillment_status: 'NOT_STARTED',
        order_status: 'CLOSED',
        paid_amount: new Prisma.Decimal('19.90'),
        payment_resolution: 'MANUAL_REQUIRED',
        payment_status: 'PAID',
        refunded_amount: new Prisma.Decimal(0),
        refund_processing_status: 'FAILED',
        refund_progress_status: 'NONE',
      });
      await expect(transaction.refund.findUnique({
        include: { attempts: true, items: true },
        where: { id: refundId },
      })).resolves.toMatchObject({
        amount: new Prisma.Decimal('19.90'),
        attempts: [expect.objectContaining({ failure_code: 'PROVIDER_UNAVAILABLE', status: 'FAILED' })],
        failure_code: 'PROVIDER_UNAVAILABLE',
        items: [expect.objectContaining({ auto_restock: false, commission_reversal: new Prisma.Decimal(0) })],
        status: 'FAILED',
      });
      await expect(transaction.orderItem.findUnique({ where: { id: fixture.orderItemId } })).resolves.toMatchObject({
        pre_shipment_refunded_qty: 0,
        refunded_amount: new Prisma.Decimal(0),
        refunded_qty: 0,
        shipped_qty: 0,
      });
      await expect(transaction.inventoryReservation.findUnique({ where: { id: fixture.reservationId } }))
        .resolves.toMatchObject({ consumed_at: null, status: 'RELEASED' });
      await expect(transaction.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 0, physical_qty: 5 });
      await expect(transaction.inventoryLedger.count({
        where: { business_id: fixture.reservationId, ledger_type: 'ORDER_PAID_DEDUCT' },
      })).resolves.toBe(0);
      await expect(transaction.orderAttributionSnapshot.count({ where: { order_id: fixture.orderId } }))
        .resolves.toBe(0);
      await expect(transaction.orderItemCommissionSnapshot.count({
        where: { order_item_id: fixture.orderItemId },
      })).resolves.toBe(0);
      await expect(transaction.product.findUnique({ where: { id: fixture.productId } }))
        .resolves.toMatchObject({ sales_count: 0 });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: fixture.orderId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
    if (refundId !== undefined) {
      await expect(runtime.prisma.refund.count({ where: { id: refundId } })).resolves.toBe(0);
    }
  }, 120_000);
});
