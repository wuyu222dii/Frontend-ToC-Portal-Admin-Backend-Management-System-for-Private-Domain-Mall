import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
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

async function seedSettlementFixture(
  transaction: DatabaseTransaction,
  fixture: SettlementFixture,
  now: Date,
  options: {
    agent?: { agentId: string; bindingId: string };
    createBalance?: boolean;
  } = {},
): Promise<void> {
  const { agent, createBalance = true } = options;
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
        locked_qty: 1,
        physical_qty: 5,
        sku_id: fixture.skuId,
        updated_at: now,
        version: 1,
      },
    });
  }
  const expiresAt = new Date(now.getTime() + 30 * 60_000);
  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: fixture.customerId,
      fulfillment_status: 'NOT_STARTED',
      goods_amount: new Prisma.Decimal('19.90'),
      id: fixture.orderId,
      order_no: `QX${fixture.orderId}`,
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
      brand_name_snapshot: `B102 Brand ${fixture.brandId}`,
      category_id: fixture.categoryId,
      category_name_snapshot: `B102 Category ${fixture.categoryId}`,
      created_at: now,
      id: fixture.orderItemId,
      line_paid_amount: new Prisma.Decimal('19.90'),
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: fixture.productId,
      product_name_snapshot: `B102 Product ${fixture.productId}`,
      quantity: 1,
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
      quantity: 1,
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
      locked_after: 1,
      locked_change: 1,
      occurred_at: now,
      physical_after: 5,
      physical_change: 0,
      reason: 'ORDER_RESERVE',
      sku_id: fixture.skuId,
    },
  });
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
    const agentAccountId = generateUlid(now.getTime() - 17_000);
    const agentId = generateUlid(now.getTime() - 16_000);
    const bindingId = generateUlid(now.getTime() - 15_000);
    const ruleVersionId = generateUlid(now.getTime() - 2_000);
    const ruleEntryId = generateUlid(now.getTime() - 1_900);
    let paymentIntentId: string | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: {
          created_at: now,
          id: agentAccountId,
          login_name: `b102-agent-${agentAccountId}`,
          password_hash: 'b102-integration-password-hash',
          role: 'AGENT_ADMIN',
          status: 'ACTIVE',
          updated_at: now,
          version: 1,
        },
      });
      await transaction.agentProfile.create({
        data: {
          account_id: agentAccountId,
          agent_no: `B102-${agentId.slice(-20)}`,
          created_at: now,
          id: agentId,
          name: 'B10.2 Integration Agent',
          product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
          status: 'ACTIVE',
          updated_at: now,
          version: 1,
        },
      });
      await seedSettlementFixture(transaction, fixture, now, { agent: { agentId, bindingId } });

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
          created_by_id: agentAccountId,
          effective_at: null,
          id: ruleVersionId,
          reason: `B10.2 ${rate} commission integration fixture`,
          status: 'DRAFT',
          version_no: versionNo,
        },
      });
      await transaction.commissionRuleEntry.create({
        data: {
          configured_rate: new Prisma.Decimal(rate),
          created_at: now,
          id: ruleEntryId,
          rule_version_id: ruleVersionId,
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
        where: { id: ruleVersionId },
      });

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
});
