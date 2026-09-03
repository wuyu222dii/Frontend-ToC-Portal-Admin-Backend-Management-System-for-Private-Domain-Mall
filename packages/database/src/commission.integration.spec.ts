import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { AgentOperationsRepository } from './agent-operations.repository';
import {
  CommissionRepository,
  type CommissionRuleChange,
  type CommissionRuleVersionSnapshot,
} from './commission.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StorePaymentRepository, type StorePaymentCallbackInput } from './store-payment.repository';
import { isRetryableTransactionError } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B134_AGENT_FINANCE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B134_AGENT_FINANCE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B134_COMMISSION_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface RuleFixture {
  adminAccountId: string;
  brandId: string;
  categoryId: string;
  productId: string;
  skuId: string;
}

interface PaymentLeg {
  accountId: string;
  addressId: string;
  attributionId: string;
  bindingId: string;
  customerId: string;
  orderId: string;
  orderItemId: string;
  phoneVerificationId: string;
  reservationId: string;
  reservationItemId: string;
  reserveLedgerId: string;
}

interface FullFixture extends RuleFixture {
  agentAccountId: string;
  agentId: string;
  balanceId: string;
  legs: [PaymentLeg, PaymentLeg];
  walletId: string;
}

interface OpenPayment {
  callback: StorePaymentCallbackInput;
  paymentIntentId: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface CommissionLockBarrier {
  acquired: Deferred<void>;
  intercepted: boolean;
  release: Deferred<void>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B13.4 commission database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.4 commission tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let databaseName: string;
    let username: string;
    try {
      databaseName = decodeURIComponent(url.pathname.slice(1));
      username = decodeURIComponent(url.username);
    } catch {
      throw new TypeError('B13.4 commission DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.4 commission tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b134-commission-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.4 commission tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b134-commission-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function fullCleanupConnectionString(): string {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let databaseName: string;
  let username: string;
  try {
    databaseName = decodeURIComponent(directUrl.pathname.slice(1));
    username = decodeURIComponent(directUrl.username);
  } catch {
    throw new TypeError('B13.4 commission cleanup URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B13.4 cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
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

function ruleFixture(): RuleFixture {
  return {
    adminAccountId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    productId: generateUlid(),
    skuId: generateUlid(),
  };
}

function paymentLeg(): PaymentLeg {
  return {
    accountId: generateUlid(),
    addressId: generateUlid(),
    attributionId: generateUlid(),
    bindingId: generateUlid(),
    customerId: generateUlid(),
    orderId: generateUlid(),
    orderItemId: generateUlid(),
    phoneVerificationId: generateUlid(),
    reservationId: generateUlid(),
    reservationItemId: generateUlid(),
    reserveLedgerId: generateUlid(),
  };
}

function fullFixture(): FullFixture {
  return {
    ...ruleFixture(),
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    balanceId: generateUlid(),
    legs: [paymentLeg(), paymentLeg()],
    walletId: generateUlid(),
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function seedRuleFixture(
  transaction: DatabaseTransaction,
  ids: RuleFixture,
  now: Date,
): Promise<void> {
  await transaction.account.create({
    data: {
      created_at: now,
      id: ids.adminAccountId,
      login_name: `b134-admin-${ids.adminAccountId}`,
      must_change_password: false,
      password_hash: 'b134-fixture-password-hash',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: ids.brandId,
      name: `B13.4 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: ids.categoryId,
      name: `B13.4 Category ${ids.categoryId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: ids.brandId,
      category_id: ids.categoryId,
      created_at: now,
      id: ids.productId,
      name: `B13.4 Product ${ids.productId}`,
      published_at: now,
      sales_count: 0,
      spu_code: `B134-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B134-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B13.4 Integration SKU',
      product_id: ids.productId,
      retail_price: '19.90',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
}

async function seedFullFixture(
  transaction: DatabaseTransaction,
  ids: FullFixture,
  now: Date,
): Promise<void> {
  await seedRuleFixture(transaction, ids, now);
  await transaction.account.create({
    data: {
      created_at: now,
      id: ids.agentAccountId,
      login_name: `b134-agent-${ids.agentAccountId}`,
      must_change_password: false,
      password_hash: 'b134-fixture-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.agentAccountId,
      agent_no: `B134-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B13.4 Integration Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentWallet.create({
    data: {
      agent_id: ids.agentId,
      available_balance: '0.00',
      frozen_balance: '0.00',
      id: ids.walletId,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: ids.balanceId,
      locked_qty: ids.legs.length,
      physical_qty: 5,
      sku_id: ids.skuId,
      updated_at: now,
      version: 1,
    },
  });

  for (const [index, leg] of ids.legs.entries()) {
    const orderCreatedAt = new Date(now.getTime() - 60_000 + index);
    const expiresAt = new Date(orderCreatedAt.getTime() + 30 * 60_000);
    await transaction.account.create({
      data: {
        created_at: now,
        id: leg.accountId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
        wechat_open_id: `b134-customer-${leg.accountId}`,
      },
    });
    await transaction.customerProfile.create({
      data: {
        account_id: leg.accountId,
        city: 'Auckland',
        created_at: now,
        id: leg.customerId,
        nickname: `B13.4 Customer ${index + 1}`,
        registered_at: now,
        updated_at: now,
        version: 1,
      },
    });
    await transaction.customerPhoneVerification.create({
      data: {
        consent_version: 'b134-consent-v1',
        created_at: now,
        customer_id: leg.customerId,
        encryption_key_id: 'b134-field-key-v1',
        id: leg.phoneVerificationId,
        phone_ciphertext: Buffer.from(`b134-phone-${leg.customerId}`),
        phone_hash: digest(`${leg.customerId}:phone`),
        phone_last4: index === 0 ? '1341' : '1342',
        source: 'B134_INTEGRATION',
        verified_at: new Date(now.getTime() - 120_000),
      },
    });
    await transaction.customerAgentBinding.create({
      data: {
        agent_id: ids.agentId,
        created_at: new Date(now.getTime() - 180_000),
        customer_id: leg.customerId,
        id: leg.bindingId,
        started_at: new Date(now.getTime() - 180_000),
      },
    });
    await transaction.salesOrder.create({
      data: {
        created_at: orderCreatedAt,
        customer_id: leg.customerId,
        fulfillment_status: 'NOT_STARTED',
        goods_amount: '19.90',
        id: leg.orderId,
        order_no: `B134${leg.orderId}`,
        order_status: 'PENDING_PAYMENT',
        paid_amount: '0.00',
        pay_expires_at: expiresAt,
        payable_amount: '19.90',
        payment_resolution: 'NORMAL',
        payment_status: 'UNPAID',
        refund_processing_status: 'IDLE',
        refund_progress_status: 'NONE',
        refunded_amount: '0.00',
        shipping_amount: '0.00',
        source: 'BUY_NOW',
        updated_at: now,
        version: 1,
      },
    });
    await transaction.orderItem.create({
      data: {
        aftersale_reserved_amount: '0.00',
        aftersale_reserved_qty: 0,
        brand_name_snapshot: `B13.4 Brand ${ids.brandId}`,
        category_id: ids.categoryId,
        category_name_snapshot: `B13.4 Category ${ids.categoryId}`,
        created_at: now,
        id: leg.orderItemId,
        line_paid_amount: '19.90',
        order_id: leg.orderId,
        pre_shipment_refunded_qty: 0,
        product_id: ids.productId,
        product_name_snapshot: `B13.4 Product ${ids.productId}`,
        quantity: 1,
        refunded_amount: '0.00',
        refunded_qty: 0,
        shipped_qty: 0,
        sku_code_snapshot: `B134-${ids.skuId}`,
        sku_id: ids.skuId,
        sku_name_snapshot: 'B13.4 Integration SKU',
        unit_price: '19.90',
        version: 1,
      },
    });
    await transaction.orderAddressSnapshot.create({
      data: {
        city: 'Auckland',
        created_at: now,
        detail_ciphertext: Buffer.from(`b134-detail-${leg.orderId}`),
        district: 'Central',
        encryption_key_id: 'b134-order-key-v1',
        id: leg.addressId,
        order_id: leg.orderId,
        phone_ciphertext: Buffer.from(`b134-address-${leg.orderId}`),
        phone_last4: index === 0 ? '2461' : '2462',
        province: 'Auckland',
        recipient_name: `B13.4 Recipient ${index + 1}`,
      },
    });
    await transaction.orderAttributionCandidate.create({
      data: {
        binding_id: leg.bindingId,
        candidate_agent_id: ids.agentId,
        id: leg.attributionId,
        order_id: leg.orderId,
        submit_channel: 'AGENT',
        submitted_at: new Date(now.getTime() - 30_000 + index),
      },
    });
    await transaction.inventoryReservation.create({
      data: {
        created_at: now,
        expires_at: expiresAt,
        id: leg.reservationId,
        order_id: leg.orderId,
        status: 'ACTIVE',
      },
    });
    await transaction.inventoryReservationItem.create({
      data: {
        created_at: now,
        id: leg.reservationItemId,
        quantity: 1,
        reservation_id: leg.reservationId,
        sku_id: ids.skuId,
      },
    });
    await transaction.inventoryLedger.create({
      data: {
        actor_account_id: leg.accountId,
        business_id: leg.reservationId,
        id: leg.reserveLedgerId,
        ledger_type: 'ORDER_RESERVE',
        locked_after: index + 1,
        locked_change: 1,
        occurred_at: new Date(now.getTime() + index),
        physical_after: 5,
        physical_change: 0,
        reason: 'ORDER_RESERVE',
        sku_id: ids.skuId,
      },
    });
  }
}

function initialChanges(ids: RuleFixture, includePlatform: boolean): CommissionRuleChange[] {
  return [
    ...(includePlatform
      ? [{ configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' } as const]
      : []),
    { configuredRate: '7.5000', targetId: ids.categoryId, targetType: 'CATEGORY' },
    { configuredRate: '0.0000', targetId: ids.skuId, targetType: 'SKU' },
  ];
}

function isCommissionLock(query: string, values: readonly unknown[]): boolean {
  return query.includes('pg_advisory_xact_lock') && values[0] === 'commission-rule-config' &&
    values[1] === JSON.stringify(['singleton']);
}

function transactionWithCommissionBarrier(
  transaction: DatabaseTransaction,
  barrier: CommissionLockBarrier,
): DatabaseTransaction {
  return new Proxy(transaction, {
    get(target, property) {
      if (property === '$queryRawUnsafe') {
        return async (query: string, ...values: unknown[]) => {
          if (!barrier.intercepted && isCommissionLock(query, values)) {
            barrier.intercepted = true;
            const result = await target.$queryRawUnsafe(query, ...values);
            barrier.acquired.resolve();
            await barrier.release.promise;
            return result as unknown;
          }
          return target.$queryRawUnsafe(query, ...values);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function observeBlockedAdvisoryLockPairs(runtime: DatabaseRuntime): Promise<number> {
  for (let observation = 0; observation < 500; observation += 1) {
    const result = await runtime.pool.query<{ blocked_count: number }>(`
      WITH advisory_locks AS (
        SELECT classid, objid, objsubid, pid, granted
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      )
      SELECT COUNT(*)::integer AS blocked_count
      FROM advisory_locks AS waiter
      INNER JOIN advisory_locks AS holder
        ON holder.classid = waiter.classid
       AND holder.objid = waiter.objid
       AND holder.objsubid = waiter.objsubid
       AND holder.pid <> waiter.pid
      WHERE waiter.granted = false AND holder.granted = true
    `);
    const blockedCount = result.rows[0]?.blocked_count ?? 0;
    if (blockedCount > 0) return blockedCount;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return 0;
}

async function waitForBarrier<T>(barrier: CommissionLockBarrier, operation: Promise<T>, label: string): Promise<void> {
  await Promise.race([
    barrier.acquired.promise,
    operation.then(
      () => { throw new Error(`${label} completed before acquiring the commission lock`); },
      (error: unknown) => { throw error; },
    ),
  ]);
}

function hasPostgresCode(value: unknown, code: string, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.code === code || record.originalCode === code || record.sqlState === code) return true;
  return ['cause', 'driverAdapterError', 'meta', 'originalError']
    .some((key) => hasPostgresCode(record[key], code, seen));
}

async function runSerializableWithoutDeadlockRetry<T>(
  runtime: DatabaseRuntime,
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runtime.prisma.$transaction(work, transactionOptions);
    } catch (error) {
      if (hasPostgresCode(error, '40P01') || attempt >= 5 || !isRetryableTransactionError(error)) throw error;
    }
  }
}

async function openPayment(
  runtime: DatabaseRuntime,
  repository: StorePaymentRepository,
  leg: PaymentLeg,
): Promise<OpenPayment> {
  return runtime.prisma.$transaction(async (transaction) => {
    const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
      accountId: leg.accountId,
      customerId: leg.customerId,
      expectedVersion: 1,
      orderId: leg.orderId,
      provider: 'MOCK',
      reconcileAfterMs: 30_000,
    });
    const paymentIntentId = prepared.intent.paymentIntentId;
    const providerIntentId = `b134-intent-${paymentIntentId}`;
    const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
      expectedVersion: 1,
      orderId: leg.orderId,
      paymentIntentId,
      provider: 'MOCK',
      result: {
        kind: 'OPEN',
        nextReconcileAt: new Date(prepared.intent.serverTime.getTime() + 60_000),
        providerIntentId,
        providerState: 'OPEN',
      },
    });
    return {
      callback: {
        amount: '19.90',
        eventType: 'payment.succeeded',
        occurredAt: opened.intent.serverTime,
        outcome: 'SUCCEEDED',
        provider: 'MOCK',
        providerEventId: `b134-event-${paymentIntentId}`,
        providerIntentId,
        providerTransactionId: `b134-transaction-${paymentIntentId}`,
      },
      paymentIntentId,
    };
  }, transactionOptions);
}

async function assertRuleFixtureAbsent(runtime: DatabaseRuntime, ids: RuleFixture): Promise<void> {
  const counts = await Promise.all([
    runtime.prisma.commissionRuleEntry.count({ where: { rule_version: { created_by_id: ids.adminAccountId } } }),
    runtime.prisma.commissionRuleVersion.count({ where: { created_by_id: ids.adminAccountId } }),
    runtime.prisma.sku.count({ where: { id: ids.skuId } }),
    runtime.prisma.product.count({ where: { id: ids.productId } }),
    runtime.prisma.category.count({ where: { id: ids.categoryId } }),
    runtime.prisma.brand.count({ where: { id: ids.brandId } }),
    runtime.prisma.account.count({ where: { id: ids.adminAccountId } }),
  ]);
  expect(counts).toEqual(Array.from({ length: counts.length }, () => 0));
}

async function ruleHistorySnapshot(runtime: DatabaseRuntime): Promise<string> {
  const [versions, entries] = await runtime.prisma.$transaction(async (transaction) => Promise.all([
    transaction.commissionRuleVersion.findMany({ orderBy: [{ version_no: 'asc' }, { id: 'asc' }] }),
    transaction.commissionRuleEntry.findMany({ orderBy: [{ rule_version_id: 'asc' }, { target_key: 'asc' }, { id: 'asc' }] }),
  ]), { isolationLevel: 'RepeatableRead' });
  return JSON.stringify({ entries, versions });
}

async function assertFullFixtureAbsent(runtime: DatabaseRuntime, ids: FullFixture): Promise<void> {
  const orderIds = ids.legs.map(({ orderId }) => orderId);
  const customerIds = ids.legs.map(({ customerId }) => customerId);
  const reservationIds = ids.legs.map(({ reservationId }) => reservationId);
  const accountIds = [ids.adminAccountId, ids.agentAccountId, ...ids.legs.map(({ accountId }) => accountId)];
  const counts = await Promise.all([
    runtime.prisma.commissionLedger.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.orderItemCommissionPosition.count({ where: { snapshot: { agent_id: ids.agentId } } }),
    runtime.prisma.orderItemCommissionSnapshot.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.agentCustomerPrivacyProjection.count({ where: { customer_id: { in: customerIds } } }),
    runtime.prisma.orderAttributionSnapshot.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.paymentAttempt.count({ where: { payment_intent: { order_id: { in: orderIds } } } }),
    runtime.prisma.paymentIntent.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.inventoryLedger.count({ where: { sku_id: ids.skuId } }),
    runtime.prisma.inventoryReservationItem.count({ where: { reservation_id: { in: reservationIds } } }),
    runtime.prisma.inventoryReservation.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.orderAttributionCandidate.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.orderAddressSnapshot.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
    runtime.prisma.customerAgentBinding.count({ where: { customer_id: { in: customerIds } } }),
    runtime.prisma.customerPhoneVerification.count({ where: { customer_id: { in: customerIds } } }),
    runtime.prisma.customerProfile.count({ where: { id: { in: customerIds } } }),
    runtime.prisma.agentWallet.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.agentProfile.count({ where: { id: ids.agentId } }),
    runtime.prisma.commissionRuleEntry.count({ where: { rule_version: { created_by_id: ids.adminAccountId } } }),
    runtime.prisma.commissionRuleVersion.count({ where: { created_by_id: ids.adminAccountId } }),
    runtime.prisma.inventoryBalance.count({ where: { id: ids.balanceId } }),
    runtime.prisma.sku.count({ where: { id: ids.skuId } }),
    runtime.prisma.product.count({ where: { id: ids.productId } }),
    runtime.prisma.category.count({ where: { id: ids.categoryId } }),
    runtime.prisma.brand.count({ where: { id: ids.brandId } }),
    runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
  ]);
  expect(counts).toEqual(Array.from({ length: counts.length }, () => 0));
  await expect(runtime.prisma.commissionRuleVersion.count()).resolves.toBe(0);
}

async function cleanupFullFixture(connectionString: string, ids: FullFixture): Promise<void> {
  const pool = new Pool({
    application_name: 'qingxu-b134-commission-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  const orderIds = ids.legs.map(({ orderId }) => orderId);
  const customerIds = ids.legs.map(({ customerId }) => customerId);
  const reservationIds = ids.legs.map(({ reservationId }) => reservationId);
  const accountIds = [ids.adminAccountId, ids.agentAccountId, ...ids.legs.map(({ accountId }) => accountId)];
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public.commission_ledger WHERE agent_id = $1', [ids.agentId]);
    await client.query(
      'DELETE FROM public.order_item_commission_position WHERE snapshot_id IN (SELECT id FROM public.order_item_commission_snapshot WHERE agent_id = $1)',
      [ids.agentId],
    );
    await client.query('DELETE FROM public.order_item_commission_snapshot WHERE agent_id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.agent_customer_privacy_projection WHERE customer_id::text = ANY($1::text[])', [
      customerIds,
    ]);
    await client.query('DELETE FROM public.order_attribution_snapshot WHERE order_id::text = ANY($1::text[])', [
      orderIds,
    ]);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id IN (SELECT id FROM public.payment_intent WHERE order_id::text = ANY($1::text[]))',
      [orderIds],
    );
    await client.query('DELETE FROM public.payment_intent WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.inventory_ledger WHERE sku_id = $1', [ids.skuId]);
    await client.query('DELETE FROM public.inventory_reservation_item WHERE reservation_id::text = ANY($1::text[])', [
      reservationIds,
    ]);
    await client.query('DELETE FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_attribution_candidate WHERE order_id::text = ANY($1::text[])', [
      orderIds,
    ]);
    await client.query('DELETE FROM public.order_address_snapshot WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_item WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.customer_agent_binding WHERE customer_id::text = ANY($1::text[])', [
      customerIds,
    ]);
    await client.query('DELETE FROM public.customer_phone_verification WHERE customer_id::text = ANY($1::text[])', [
      customerIds,
    ]);
    await client.query('DELETE FROM public.customer_profile WHERE id::text = ANY($1::text[])', [customerIds]);
    await client.query('DELETE FROM public.agent_wallet WHERE agent_id = $1', [ids.agentId]);
    await client.query('ALTER TABLE public.commission_rule_entry DISABLE TRIGGER trg_commission_rule_entry_append_only');
    await client.query(
      'DELETE FROM public.commission_rule_entry WHERE rule_version_id IN (SELECT id FROM public.commission_rule_version WHERE created_by_id = $1)',
      [ids.adminAccountId],
    );
    await client.query('ALTER TABLE public.commission_rule_entry ENABLE TRIGGER trg_commission_rule_entry_append_only');
    const rules = await client.query<{ id: string }>(
      'SELECT id FROM public.commission_rule_version WHERE created_by_id = $1 ORDER BY version_no DESC',
      [ids.adminAccountId],
    );
    for (const rule of rules.rows) {
      await client.query('DELETE FROM public.commission_rule_version WHERE id = $1', [rule.id]);
    }
    await client.query('DELETE FROM public.agent_profile WHERE id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.inventory_balance WHERE id = $1', [ids.balanceId]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [ids.skuId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [ids.productId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [ids.categoryId]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [ids.brandId]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function offsetCommissionLedgers(
  connectionString: string,
  firstLedgerId: string,
  secondLedgerId: string,
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.commission_ledger DISABLE TRIGGER trg_b13_commission_ledger');
    const first = await client.query(
      'UPDATE public.commission_ledger SET expected_change = expected_change - 1 WHERE id = $1',
      [firstLedgerId],
    );
    const second = await client.query(
      'UPDATE public.commission_ledger SET expected_change = expected_change + 1 WHERE id = $1',
      [secondLedgerId],
    );
    if (first.rowCount !== 1 || second.rowCount !== 1) throw new Error('Commission corruption fixture is incomplete');
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('ALTER TABLE public.commission_ledger ENABLE TRIGGER trg_b13_commission_ledger');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function setCommissionRuleStatus(
  connectionString: string,
  ruleVersionId: string,
  status: 'ARCHIVED' | 'DRAFT',
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'ALTER TABLE public.commission_rule_version DISABLE TRIGGER trg_commission_rule_version_immutable',
    );
    const result = await client.query(
      'UPDATE public.commission_rule_version SET status = $2 WHERE id = $1',
      [ruleVersionId, status],
    );
    if (result.rowCount !== 1) throw new Error('Commission rule corruption fixture is incomplete');
    await client.query(
      'ALTER TABLE public.commission_rule_version ENABLE TRIGGER trg_commission_rule_version_immutable',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

databaseDescribe('B13.4 commission PostgreSQL integration', () => {
  let cleanupConnectionString: string | undefined;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    if (mode === 'full') cleanupConnectionString = fullCleanupConnectionString();
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('publishes successive complete versions, preserves zero versus inheritance, and rolls back exactly',
    async () => {
      const ids = ruleFixture();
      const now = new Date();
      const historyBefore = await ruleHistorySnapshot(runtime);
      let firstId: string | undefined;
      let secondId: string | undefined;
      try {
        await expect(runtime.withPrismaTransaction(async (transaction) => {
          const baseline = await transaction.commissionRuleVersion.findMany({
            orderBy: [{ version_no: 'asc' }, { id: 'asc' }],
            select: { id: true, status: true, version_no: true },
          });
          const baselineCurrent = baseline.find(({ status }) => status === 'PUBLISHED') ?? null;
          const maxVersionNo = baseline.at(-1)?.version_no ?? 0;
          await seedRuleFixture(transaction, ids, now);
          const repository = new CommissionRepository(transactionBoundPrisma(transaction));
          const first = await repository.publishRuleVersionInTransaction(transaction, {
            actorAccountId: ids.adminAccountId,
            baseVersionId: baselineCurrent?.id ?? null,
            changes: initialChanges(ids, baselineCurrent === null),
            expectedCurrentPublishedId: baselineCurrent?.id ?? null,
            expectedMaxVersionNo: maxVersionNo,
            expectedVersion: baselineCurrent?.version_no ?? 0,
            reason: 'B13.4 initial commission rules',
          }, { verifyPreview: () => undefined });
          firstId = first.version.versionId;
          expect(first).toMatchObject({
            before: baselineCurrent === null
              ? null
              : {
                  status: 'PUBLISHED',
                  version: baselineCurrent.version_no,
                  versionId: baselineCurrent.id,
                },
            version: {
              baseVersionId: baselineCurrent?.id ?? null,
              status: 'PUBLISHED',
              versionNo: maxVersionNo + 1,
            },
          });
          const zero = (await repository.getCurrentRules()).items.find(({ skuId }) => skuId === ids.skuId);
          expect(zero).toMatchObject({ configuredRate: '0.0000', effectiveRate: '0.0000', source: 'SKU' });

          const second = await repository.publishRuleVersionInTransaction(transaction, {
            actorAccountId: ids.adminAccountId,
            baseVersionId: first.version.versionId,
            changes: [{ configuredRate: null, targetId: ids.skuId, targetType: 'SKU' }],
            expectedCurrentPublishedId: first.version.versionId,
            expectedMaxVersionNo: maxVersionNo + 1,
            expectedVersion: maxVersionNo + 1,
            reason: 'B13.4 remove SKU override',
          }, { verifyPreview: () => undefined });
          secondId = second.version.versionId;
          expect(second).toMatchObject({
            before: {
              status: 'PUBLISHED',
              version: maxVersionNo + 1,
              versionId: first.version.versionId,
            },
            version: {
              baseVersionId: first.version.versionId,
              status: 'PUBLISHED',
              versionNo: maxVersionNo + 2,
            },
          });

          const current = await repository.getCurrentRules();
          expect(current.categories.find(({ categoryId }) => categoryId === ids.categoryId)).toMatchObject({
            configuredRate: '7.5000', effectiveRate: '7.5000', source: 'CATEGORY',
          });
          expect(current.items.find(({ skuId }) => skuId === ids.skuId)).toMatchObject({
            configuredRate: null, effectiveRate: '7.5000', source: 'CATEGORY',
          });
          await expect(repository.listRuleSkus({ page: 1, pageSize: 100 })).resolves.toMatchObject({
            versionId: second.version.versionId,
            versionNo: maxVersionNo + 2,
          });
          const versions = await repository.listRuleVersions({ page: 1, pageSize: 100 });
          expect(versions).toMatchObject({ total: baseline.length + 2 });
          expect(versions.items.slice(0, 2).map(({ status, versionNo }) => [versionNo, status])).toEqual([
            [maxVersionNo + 2, 'PUBLISHED'],
            [maxVersionNo + 1, 'ARCHIVED'],
          ]);
          await expect(repository.getRuleVersion(first.version.versionId)).resolves.toMatchObject({
            changes: expect.arrayContaining([
              { configuredRate: '0.0000', targetId: ids.skuId, targetType: 'SKU' },
            ]),
            status: 'ARCHIVED',
          });
          await expect(repository.getRuleVersion(second.version.versionId)).resolves.toMatchObject({
            changes: [{ configuredRate: null, targetId: ids.skuId, targetType: 'SKU' }],
            status: 'PUBLISHED',
          });
          await expect(repository.getRuleVersionForReplayInTransaction(
            transaction,
            ids.adminAccountId,
            first.version.versionId,
          )).resolves.toMatchObject({ status: 'ARCHIVED', versionId: first.version.versionId });
          throw rollbackSentinel;
        }, transactionOptions)).rejects.toBe(rollbackSentinel);
      } finally {
        await assertRuleFixtureAbsent(runtime, ids);
        if (firstId !== undefined) {
          await expect(runtime.prisma.commissionRuleVersion.count({ where: { id: firstId } })).resolves.toBe(0);
        }
        if (secondId !== undefined) {
          await expect(runtime.prisma.commissionRuleVersion.count({ where: { id: secondId } })).resolves.toBe(0);
        }
        await expect(ruleHistorySnapshot(runtime)).resolves.toBe(historyBefore);
      }
    }, 120_000);

  fullIt('serializes real payment reads with rule publication and exposes only complete old or new versions',
    async () => {
      if (cleanupConnectionString === undefined) throw new TypeError('B13.4 cleanup was not initialized');
      const ids = fullFixture();
      const now = new Date();
      const commission = new CommissionRepository(runtime.prisma);
      const payment = new StorePaymentRepository();
      const releases: Array<Deferred<void>> = [];
      let racing: Promise<unknown>[] = [];
      let initial!: CommissionRuleVersionSnapshot;
      try {
        await runtime.prisma.$transaction(async (transaction) => {
          await expect(transaction.commissionRuleVersion.count()).resolves.toBe(0);
          await seedFullFixture(transaction, ids, now);
          initial = (await commission.publishRuleVersionInTransaction(transaction, {
            actorAccountId: ids.adminAccountId,
            baseVersionId: null,
            changes: [
              { configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' },
              { configuredRate: '10.0000', targetId: ids.categoryId, targetType: 'CATEGORY' },
            ],
            expectedCurrentPublishedId: null,
            expectedMaxVersionNo: 0,
            expectedVersion: 0,
            reason: 'B13.4 concurrent baseline rules',
          }, { verifyPreview: () => undefined })).version;
        }, transactionOptions);

        const opened: OpenPayment[] = [];
        for (const leg of ids.legs) opened.push(await openPayment(runtime, payment, leg));
        const publisherBarrier: CommissionLockBarrier = {
          acquired: deferred<void>(),
          intercepted: false,
          release: deferred<void>(),
        };
        releases.push(publisherBarrier.release);
        const publishSecond = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          commission.publishRuleVersionInTransaction(
            transactionWithCommissionBarrier(transaction, publisherBarrier),
            {
              actorAccountId: ids.adminAccountId,
              baseVersionId: initial.versionId,
              changes: [{ configuredRate: '20.0000', targetId: ids.categoryId, targetType: 'CATEGORY' }],
              expectedCurrentPublishedId: initial.versionId,
              expectedMaxVersionNo: 1,
              expectedVersion: 1,
              reason: 'B13.4 publisher-first rules',
            },
            { verifyPreview: () => undefined },
          ));
        await waitForBarrier(publisherBarrier, publishSecond, 'Commission publication');
        const payAfterPublisher = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          payment.applyPaymentCallbackInTransaction(transaction, opened[0]!.callback));
        racing = [publishSecond, payAfterPublisher];
        const publisherBlockedPair = await observeBlockedAdvisoryLockPairs(runtime);
        publisherBarrier.release.resolve();
        const [second, firstPayment] = await Promise.all([publishSecond, payAfterPublisher]);
        racing = [];
        expect(publisherBlockedPair).toBeGreaterThan(0);
        expect(firstPayment).toMatchObject({ changed: true, finalAgentId: ids.agentId, kind: 'SETTLED' });
        const firstSnapshot = await runtime.prisma.orderItemCommissionSnapshot.findUniqueOrThrow({
          where: { order_item_id: ids.legs[0].orderItemId },
        });
        expect(firstSnapshot).toMatchObject({
          rule_version_id: initial.versionId,
          source_type: 'CATEGORY',
        });
        expect(firstSnapshot.effective_rate.toFixed(4)).toBe('10.0000');
        const secondEntries = await runtime.prisma.commissionRuleEntry.findMany({
          orderBy: [{ target_key: 'asc' }],
          where: { rule_version_id: second.version.versionId },
        });
        expect(secondEntries.map(({ configured_rate, target_key }) => [target_key, configured_rate.toFixed(4)]))
          .toEqual([[`CATEGORY:${ids.categoryId}`, '20.0000'], ['PLATFORM', '5.0000']]);

        const paidAfterSecond = await runtime.pool.query<{ occurred_at: Date }>(
          'SELECT clock_timestamp() AS occurred_at',
        );
        opened[1]!.callback.occurredAt = paidAfterSecond.rows[0]!.occurred_at;
        const paymentBarrier: CommissionLockBarrier = {
          acquired: deferred<void>(),
          intercepted: false,
          release: deferred<void>(),
        };
        releases.push(paymentBarrier.release);
        const payBeforePublisher = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          payment.applyPaymentCallbackInTransaction(
            transactionWithCommissionBarrier(transaction, paymentBarrier),
            opened[1]!.callback,
          ));
        await waitForBarrier(paymentBarrier, payBeforePublisher, 'Payment callback');
        const publishThird = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          commission.publishRuleVersionInTransaction(transaction, {
            actorAccountId: ids.adminAccountId,
            baseVersionId: second.version.versionId,
            changes: [{ configuredRate: '30.0000', targetId: ids.categoryId, targetType: 'CATEGORY' }],
            expectedCurrentPublishedId: second.version.versionId,
            expectedMaxVersionNo: 2,
            expectedVersion: 2,
            reason: 'B13.4 payment-first rules',
          }, { verifyPreview: () => undefined }));
        racing = [payBeforePublisher, publishThird];
        const paymentBlockedPair = await observeBlockedAdvisoryLockPairs(runtime);
        paymentBarrier.release.resolve();
        const [secondPayment, third] = await Promise.all([payBeforePublisher, publishThird]);
        racing = [];
        expect(paymentBlockedPair).toBeGreaterThan(0);
        expect(secondPayment).toMatchObject({ changed: true, finalAgentId: ids.agentId, kind: 'SETTLED' });
        const secondSnapshot = await runtime.prisma.orderItemCommissionSnapshot.findUniqueOrThrow({
          where: { order_item_id: ids.legs[1].orderItemId },
        });
        expect(secondSnapshot).toMatchObject({
          rule_version_id: second.version.versionId,
          source_type: 'CATEGORY',
        });
        expect(secondSnapshot.effective_rate.toFixed(4)).toBe('20.0000');
        const currentEntries = await runtime.prisma.commissionRuleEntry.findMany({
          orderBy: [{ target_key: 'asc' }],
          where: { rule_version_id: third.version.versionId },
        });
        expect(currentEntries.map(({ configured_rate, target_key }) => [target_key, configured_rate.toFixed(4)]))
          .toEqual([[`CATEGORY:${ids.categoryId}`, '30.0000'], ['PLATFORM', '5.0000']]);

        const operations = new AgentOperationsRepository(runtime.prisma);
        const identity = { accountId: ids.agentAccountId, agentId: ids.agentId };
        const agentCommissions = await operations.listCommissions({ ...identity, page: 1, pageSize: 20 });
        expect(agentCommissions).toMatchObject({ total: 2 });
        expect(agentCommissions.items).toEqual(expect.arrayContaining([
          expect.objectContaining({
            effectiveRate: '20.0000',
            expectedChange: '3.98',
            ledgerType: 'EXPECTED_CREATED',
            originalCommission: '3.98',
            positionState: 'EXPECTED',
          }),
        ]));
        const agentDetail = await operations.getCommission({
          ...identity,
          commissionSnapshotId: firstSnapshot.id,
        });
        expect(agentDetail).toMatchObject({
          commissionSnapshotId: firstSnapshot.id,
          effectiveRate: '10.0000',
          expectedRemaining: '1.99',
          originalCommission: '1.99',
          positionState: 'EXPECTED',
          ruleSource: 'CATEGORY',
          ruleVersionId: initial.versionId,
        });
        expect(agentDetail.hitPath).toEqual([
          `RULE_VERSION:${initial.versionId}`,
          'PLATFORM',
          `CATEGORY:${ids.categoryId}`,
        ]);
        await expect(operations.getCommission({
          accountId: ids.legs[0].accountId,
          agentId: ids.agentId,
          commissionSnapshotId: firstSnapshot.id,
        })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
        await expect(operations.getWallet(identity)).resolves.toMatchObject({
          availableBalance: '0.00',
          expectedCommission: '5.97',
          frozenBalance: '0.00',
          withdrawalAllowed: false,
        });
        await expect(operations.getDashboard(identity)).resolves.toMatchObject({
          attributedCustomerCount: 2,
          commissionExceptionCount: 0,
          expectedCommission: '5.97',
          pendingWithdrawalCount: 0,
        });

        await expect(commission.listAdminAgentCommissions({
          agentId: ids.agentId,
          page: 1,
          pageSize: 20,
        })).resolves.toMatchObject({
          items: expect.arrayContaining([
            expect.objectContaining({
              effectiveRate: '20.0000',
              ledgerType: 'EXPECTED_CREATED',
              originalCommission: '3.98',
              positionState: 'EXPECTED',
            }),
          ]),
          total: 2,
        });
        const walletLedger = await commission.listAdminAgentWalletLedger({
          agentId: ids.agentId,
          page: 1,
          pageSize: 20,
        });
        expect(walletLedger.total).toBe(2);
        expect(walletLedger.items.map(({ expectedBalanceAfter }) => expectedBalanceAfter))
          .toEqual(['5.97', '1.99']);
        expect(walletLedger.items.every(({ referenceType }) => referenceType === 'COMMISSION_LEDGER')).toBe(true);
        await expect(commission.getOrderExplanation(ids.legs[0].orderId)).resolves.toMatchObject({
          items: [expect.objectContaining({
            commissionSnapshotId: firstSnapshot.id,
            effectiveRate: '10.0000',
            positionState: 'EXPECTED',
            ruleVersionId: initial.versionId,
          })],
          orderId: ids.legs[0].orderId,
        });
        await expect(runtime.prisma.commissionRuleVersion.findMany({
          orderBy: [{ version_no: 'asc' }],
          select: { id: true, status: true, version_no: true },
        })).resolves.toEqual([
          { id: initial.versionId, status: 'ARCHIVED', version_no: 1 },
          { id: second.version.versionId, status: 'ARCHIVED', version_no: 2 },
          { id: third.version.versionId, status: 'PUBLISHED', version_no: 3 },
        ]);
        expect((await commission.getCurrentRules()).items.find(({ skuId }) => skuId === ids.skuId))
          .toMatchObject({ configuredRate: null, effectiveRate: '30.0000', source: 'CATEGORY' });

        const [firstLedger, secondLedger] = await Promise.all([
          runtime.prisma.commissionLedger.findFirstOrThrow({
            where: { ledger_type: 'EXPECTED_CREATED', snapshot_id: firstSnapshot.id },
          }),
          runtime.prisma.commissionLedger.findFirstOrThrow({
            where: { ledger_type: 'EXPECTED_CREATED', snapshot_id: secondSnapshot.id },
          }),
        ]);
        const internalFailure = { code: 'INTERNAL_ERROR' };
        await setCommissionRuleStatus(cleanupConnectionString, initial.versionId, 'DRAFT');
        try {
          await expect(operations.getWallet(identity)).rejects.toMatchObject(internalFailure);
          await expect(operations.getDashboard(identity)).rejects.toMatchObject(internalFailure);
          await expect(commission.listAdminAgentWalletLedger({
            agentId: ids.agentId,
            page: 1,
            pageSize: 20,
          })).rejects.toMatchObject(internalFailure);
        } finally {
          await setCommissionRuleStatus(cleanupConnectionString, initial.versionId, 'ARCHIVED');
        }
        await expect(operations.getWallet(identity)).resolves.toMatchObject({ expectedCommission: '5.97' });

        await offsetCommissionLedgers(cleanupConnectionString, firstLedger.id, secondLedger.id);
        await expect(operations.listCommissions({ ...identity, page: 1, pageSize: 20 }))
          .rejects.toMatchObject(internalFailure);
        await expect(operations.getCommission({
          ...identity,
          commissionSnapshotId: firstSnapshot.id,
        })).rejects.toMatchObject(internalFailure);
        await expect(operations.getOrder({ ...identity, orderId: ids.legs[0].orderId }))
          .rejects.toMatchObject(internalFailure);
        await expect(operations.getWallet(identity)).rejects.toMatchObject(internalFailure);
        await expect(operations.getDashboard(identity)).rejects.toMatchObject(internalFailure);
        await expect(commission.listAdminAgentCommissions({
          agentId: ids.agentId,
          page: 1,
          pageSize: 20,
        })).rejects.toMatchObject(internalFailure);
        await expect(commission.listAdminAgentWalletLedger({
          agentId: ids.agentId,
          page: 1,
          pageSize: 20,
        })).rejects.toMatchObject(internalFailure);
        await expect(commission.getOrderExplanation(ids.legs[0].orderId))
          .rejects.toMatchObject(internalFailure);
      } finally {
        for (const release of releases) release.resolve();
        if (racing.length > 0) await Promise.allSettled(racing);
        await cleanupFullFixture(cleanupConnectionString, ids);
        await assertFullFixtureAbsent(runtime, ids);
      }
    }, 180_000);
});
