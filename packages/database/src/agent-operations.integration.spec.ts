import { createHash, randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { AdminCustomerRepository } from './admin-customer.repository';
import { AgentOperationsRepository } from './agent-operations.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import {
  StoreOrderRepository,
  type StoreOrderAddressSnapshotMaterial,
  type StoreOrderCreateHooks,
} from './store-order.repository';

type DatabaseTestMode = 'full' | 'rollback';
type RaceOrder = 'ORDER_FIRST' | 'TRANSFER_FIRST';

const mode = process.env.B133_AGENT_OPERATIONS_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B133_AGENT_OPERATIONS_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B133_AGENT_OPERATIONS_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  accountIds: [string, string, string, string];
  activeCandidateId: string;
  addressId: string;
  agentAId: string;
  agentBId: string;
  balanceId: string;
  bindingAId: string;
  brandId: string;
  categoryId: string;
  commissionLedgerId: string;
  commissionPositionId: string;
  commissionRuleId: string;
  commissionSnapshotId: string;
  customerId: string;
  fileId: string;
  imageId: string;
  inviteId: string;
  orderAttributionCandidateId: string;
  orderAttributionSnapshotId: string;
  orderId: string;
  orderItemId: string;
  phoneVerificationId: string;
  privacyProjectionId: string;
  productId: string;
  promotionAssetId: string;
  skuId: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface BindingLockBarrier {
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
  if (!value) throw new TypeError(`${name} is required for B13.3 Agent operations database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.3 Agent operations tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let databaseName: string;
    let username: string;
    try {
      databaseName = decodeURIComponent(url.pathname.slice(1));
      username = decodeURIComponent(url.username);
    } catch {
      throw new TypeError('B13.3 Agent operations DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.3 Agent operations tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b133-agent-operations-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.3 Agent operations tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b133-agent-operations-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
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

function newFixtureIds(): FixtureIds {
  const ids = Array.from({ length: 28 }, () => generateUlid());
  return {
    accountIds: [ids[0]!, ids[1]!, ids[2]!, ids[3]!],
    activeCandidateId: ids[4]!,
    addressId: ids[5]!,
    agentAId: ids[6]!,
    agentBId: ids[7]!,
    balanceId: ids[8]!,
    bindingAId: ids[9]!,
    brandId: ids[10]!,
    categoryId: ids[11]!,
    commissionLedgerId: ids[12]!,
    commissionPositionId: ids[13]!,
    commissionRuleId: ids[14]!,
    commissionSnapshotId: ids[15]!,
    customerId: ids[16]!,
    fileId: ids[17]!,
    imageId: ids[18]!,
    inviteId: ids[19]!,
    orderAttributionCandidateId: ids[20]!,
    orderAttributionSnapshotId: ids[21]!,
    orderId: ids[22]!,
    orderItemId: ids[23]!,
    phoneVerificationId: ids[24]!,
    privacyProjectionId: ids[25]!,
    productId: ids[26]!,
    promotionAssetId: ids[27]!,
    skuId: generateUlid(),
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function seedBaseFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  now: Date,
): Promise<void> {
  const suffix = randomUUID();
  await transaction.account.createMany({
    data: [
      {
        created_at: now,
        id: ids.accountIds[0],
        login_name: `b133-agent-a-${suffix}`,
        must_change_password: false,
        password_hash: 'b133-fixture-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: ids.accountIds[1],
        login_name: `b133-agent-b-${suffix}`,
        must_change_password: false,
        password_hash: 'b133-fixture-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: ids.accountIds[2],
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
        wechat_open_id: `b133-customer-${suffix}`,
      },
      {
        created_at: now,
        id: ids.accountIds[3],
        login_name: `b133-admin-${suffix}`,
        must_change_password: false,
        password_hash: 'b133-fixture-password-hash',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.agentProfile.createMany({
    data: [
      {
        account_id: ids.accountIds[0],
        agent_no: `B133-A-${ids.agentAId.slice(-20)}`,
        created_at: now,
        id: ids.agentAId,
        name: 'B13.3 Fixture Agent A',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        account_id: ids.accountIds[1],
        agent_no: `B133-B-${ids.agentBId.slice(-20)}`,
        created_at: now,
        id: ids.agentBId,
        name: 'B13.3 Fixture Agent B',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.accountIds[2],
      city: 'Current City',
      created_at: now,
      id: ids.customerId,
      nickname: 'Current Customer Name',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerPhoneVerification.create({
    data: {
      consent_version: 'b133-consent-v1',
      created_at: now,
      customer_id: ids.customerId,
      encryption_key_id: 'b133-field-key-v1',
      id: ids.phoneVerificationId,
      phone_ciphertext: Buffer.from('b133-current-phone'),
      phone_hash: digest(`${ids.customerId}:current-phone`),
      phone_last4: '9999',
      source: 'WECHAT',
      verified_at: now,
    },
  });
  await transaction.customerAddress.create({
    data: {
      city: 'Auckland',
      created_at: now,
      customer_id: ids.customerId,
      detail_ciphertext: Buffer.from('b133-address-detail'),
      district: 'Central',
      encryption_key_id: 'b133-address-key-v1',
      id: ids.addressId,
      is_default: true,
      phone_ciphertext: Buffer.from('b133-address-phone'),
      phone_hash: digest(`${ids.customerId}:address-phone`),
      phone_last4: '2468',
      province: 'Auckland',
      recipient_name: 'B13.3 Recipient',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerAgentBinding.create({
    data: {
      agent_id: ids.agentAId,
      created_at: new Date(now.getTime() - 7_200_000),
      customer_id: ids.customerId,
      id: ids.bindingAId,
      started_at: new Date(now.getTime() - 7_200_000),
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: ids.brandId,
      name: `B13.3 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: ids.categoryId,
      name: `B13.3 Category ${ids.categoryId}`,
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
      name: 'B13.3 Fixture Product',
      published_at: now,
      spu_code: `B133-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 128n,
      created_at: now,
      id: ids.fileId,
      mime_type: 'image/png',
      object_key: `public/${ids.fileId}`,
      original_name: 'b133-product.png',
      purpose: 'PRODUCT_IMAGE',
      sha256: digest(`${ids.fileId}:product-image`),
      status: 'READY',
      visibility: 'PUBLIC',
    },
  });
  await transaction.productImage.create({
    data: {
      created_at: now,
      file_id: ids.fileId,
      id: ids.imageId,
      product_id: ids.productId,
      sort_order: 0,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B133-SKU-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B13.3 Fixture SKU',
      product_id: ids.productId,
      retail_price: '25.00',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: ids.balanceId,
      locked_qty: 0,
      physical_qty: 10,
      sku_id: ids.skuId,
      updated_at: now,
      version: 1,
    },
  });
}

async function seedHistoricalPayment(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  now: Date,
): Promise<void> {
  const paidAt = new Date(now.getTime() - 3_600_000);
  const createdAt = new Date(paidAt.getTime() - 600_000);
  await transaction.salesOrder.create({
    data: {
      created_at: createdAt,
      customer_id: ids.customerId,
      final_agent_id: ids.agentAId,
      final_channel: 'AGENT',
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: '25.00',
      id: ids.orderId,
      order_no: `B133${ids.orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: '25.00',
      paid_at: paidAt,
      pay_expires_at: new Date(createdAt.getTime() + 1_800_000),
      payable_amount: '25.00',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: '0.00',
      shipping_amount: '0.00',
      source: 'BUY_NOW',
      updated_at: paidAt,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      brand_name_snapshot: 'B13.3 Fixture Brand',
      category_id: ids.categoryId,
      category_name_snapshot: 'B13.3 Fixture Category',
      created_at: paidAt,
      id: ids.orderItemId,
      line_paid_amount: '25.00',
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: 'B13.3 Fixture Product',
      quantity: 1,
      sku_code_snapshot: `B133-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B13.3 Fixture SKU',
      unit_price: '25.00',
      version: 1,
    },
  });
  await transaction.orderAttributionCandidate.create({
    data: {
      binding_id: ids.bindingAId,
      candidate_agent_id: ids.agentAId,
      finalization_result: 'AGENT_CONFIRMED',
      finalized_at: paidAt,
      id: ids.orderAttributionCandidateId,
      order_id: ids.orderId,
      submit_channel: 'AGENT',
      submitted_at: new Date(paidAt.getTime() - 60_000),
    },
  });
  await transaction.orderAttributionSnapshot.create({
    data: {
      agent_id_snapshot: ids.agentAId,
      binding_id_snapshot: ids.bindingAId,
      captured_at: paidAt,
      final_channel: 'AGENT',
      id: ids.orderAttributionSnapshotId,
      order_id: ids.orderId,
    },
  });
  await transaction.agentCustomerPrivacyProjection.create({
    data: {
      agent_id: ids.agentAId,
      attribution_snapshot_id: ids.orderAttributionSnapshotId,
      city: 'Frozen City',
      created_at: paidAt,
      customer_alias: 'customer_b133_frozen',
      customer_id: ids.customerId,
      id: ids.privacyProjectionId,
      nickname_masked: 'F**',
      phone_tail: '1111',
      updated_at: paidAt,
    },
  });
  const latestRule = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
  await transaction.commissionRuleVersion.create({
    data: {
      created_at: paidAt,
      created_by_id: ids.accountIds[3],
      id: ids.commissionRuleId,
      reason: 'B13.3 immutable commission fixture',
      status: 'DRAFT',
      version_no: (latestRule._max.version_no ?? 0) + 1,
    },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentAId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: 'B13.3 Fixture Category',
      commission_base: '25.00',
      created_at: paidAt,
      effective_rate: '10.0000',
      id: ids.commissionSnapshotId,
      order_item_id: ids.orderItemId,
      original_commission: '2.50',
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleId,
      sku_id_snapshot: ids.skuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      expected_remaining: '2.50',
      id: ids.commissionPositionId,
      original_commission: '2.50',
      reversed_total: '0.00',
      snapshot_id: ids.commissionSnapshotId,
      state: 'EXPECTED',
      updated_at: paidAt,
      version: 1,
    },
  });
  await transaction.commissionLedger.create({
    data: {
      agent_id: ids.agentAId,
      available_change: '0.00',
      expected_change: '2.50',
      frozen_change: '0.00',
      id: ids.commissionLedgerId,
      idempotency_key: `b133:${ids.commissionSnapshotId}`,
      ledger_type: 'EXPECTED_CREATED',
      occurred_at: paidAt,
      reason: 'B13.3_HISTORICAL_COMMISSION',
      snapshot_id: ids.commissionSnapshotId,
    },
  });
  await transaction.agentInviteCode.create({
    data: {
      agent_id: ids.agentAId,
      code_ciphertext: Buffer.from('b133-fixture-invite'),
      code_hash: digest(`${ids.inviteId}:invite`),
      code_last4: 'B133',
      created_at: new Date(now.getTime() - 1_900_000),
      effective_at: new Date(now.getTime() - 1_900_000),
      encryption_key_id: 'b133-field-key-v1',
      expires_at: new Date(now.getTime() + 3_600_000),
      id: ids.inviteId,
      status: 'ACTIVE',
    },
  });
  await transaction.promotionAsset.create({
    data: {
      agent_id: ids.agentAId,
      authorization_version: 1,
      created_at: new Date(now.getTime() - 1_800_000),
      id: ids.promotionAssetId,
      invite_code_id: ids.inviteId,
      public_url: 'https://store.example.invalid/',
      status: 'ACTIVE',
      target_type: 'STOREFRONT',
    },
  });
  await transaction.attributionCandidate.create({
    data: {
      agent_id: ids.agentAId,
      candidate_token_hash: null,
      created_at: new Date(now.getTime() - 1_700_000),
      customer_id: ids.customerId,
      expires_at: new Date(now.getTime() + 3_600_000),
      id: ids.activeCandidateId,
      invite_code_id: ids.inviteId,
      promotion_asset_id: ids.promotionAssetId,
      status: 'ACTIVE',
      updated_at: new Date(now.getTime() - 1_700_000),
    },
  });
}

async function immutablePaymentFacts(transaction: DatabaseTransaction, ids: FixtureIds) {
  return Promise.all([
    transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }),
    transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }),
    transaction.orderAttributionCandidate.findUniqueOrThrow({ where: { id: ids.orderAttributionCandidateId } }),
    transaction.orderAttributionSnapshot.findUniqueOrThrow({ where: { id: ids.orderAttributionSnapshotId } }),
    transaction.agentCustomerPrivacyProjection.findUniqueOrThrow({ where: { id: ids.privacyProjectionId } }),
    transaction.orderItemCommissionSnapshot.findUniqueOrThrow({ where: { id: ids.commissionSnapshotId } }),
    transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.commissionPositionId } }),
    transaction.commissionLedger.findUniqueOrThrow({ where: { id: ids.commissionLedgerId } }),
  ]);
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, ids: FixtureIds): Promise<void> {
  const counts = await Promise.all([
    runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } }),
    runtime.prisma.agentProfile.count({ where: { id: { in: [ids.agentAId, ids.agentBId] } } }),
    runtime.prisma.customerProfile.count({ where: { id: ids.customerId } }),
    runtime.prisma.customerPhoneVerification.count({ where: { id: ids.phoneVerificationId } }),
    runtime.prisma.customerAddress.count({ where: { id: ids.addressId } }),
    runtime.prisma.customerAgentBinding.count({ where: { customer_id: ids.customerId } }),
    runtime.prisma.bindingChangeLog.count({ where: { customer_id: ids.customerId } }),
    runtime.prisma.salesOrder.count({ where: { customer_id: ids.customerId } }),
    runtime.prisma.orderAttributionSnapshot.count({ where: { id: ids.orderAttributionSnapshotId } }),
    runtime.prisma.agentCustomerPrivacyProjection.count({ where: { id: ids.privacyProjectionId } }),
    runtime.prisma.commissionRuleVersion.count({ where: { id: ids.commissionRuleId } }),
    runtime.prisma.orderItemCommissionSnapshot.count({ where: { id: ids.commissionSnapshotId } }),
    runtime.prisma.orderItemCommissionPosition.count({ where: { id: ids.commissionPositionId } }),
    runtime.prisma.commissionLedger.count({ where: { id: ids.commissionLedgerId } }),
    runtime.prisma.agentInviteCode.count({ where: { id: ids.inviteId } }),
    runtime.prisma.promotionAsset.count({ where: { id: ids.promotionAssetId } }),
    runtime.prisma.attributionCandidate.count({ where: { id: ids.activeCandidateId } }),
    runtime.prisma.inventoryBalance.count({ where: { id: ids.balanceId } }),
    runtime.prisma.sku.count({ where: { id: ids.skuId } }),
    runtime.prisma.product.count({ where: { id: ids.productId } }),
    runtime.prisma.productImage.count({ where: { id: ids.imageId } }),
    runtime.prisma.fileAsset.count({ where: { id: ids.fileId } }),
    runtime.prisma.category.count({ where: { id: ids.categoryId } }),
    runtime.prisma.brand.count({ where: { id: ids.brandId } }),
  ]);
  expect(counts).toEqual(Array.from({ length: counts.length }, () => 0));
}

function createOrderHooks(): StoreOrderCreateHooks {
  return {
    protectAddress: (addressSnapshotId, address): StoreOrderAddressSnapshotMaterial => ({
      detailCiphertext: Buffer.from(`b133-protected-detail-${addressSnapshotId}`),
      encryptionKeyId: 'b133-order-snapshot-key',
      phoneCiphertext: Buffer.from(`b133-protected-phone-${addressSnapshotId}`),
      phoneLast4: address.phoneLast4,
    }),
    verifyQuote: () => undefined,
  };
}

function isBindingLock(query: string, values: readonly unknown[], customerId: string): boolean {
  return query.includes('pg_advisory_xact_lock') && values[0] === 'store-attribution-binding' &&
    values[1] === JSON.stringify([customerId]);
}

function transactionWithBindingBarrier(
  transaction: DatabaseTransaction,
  customerId: string,
  barrier: BindingLockBarrier,
): DatabaseTransaction {
  return new Proxy(transaction, {
    get(target, property) {
      if (property === '$queryRawUnsafe') {
        return async (query: string, ...values: unknown[]) => {
          if (!barrier.intercepted && isBindingLock(query, values, customerId)) {
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
  for (let observation = 0; observation < 200; observation += 1) {
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
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return 0;
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
      if (hasPostgresCode(error, '40P01') || attempt >= 5 || !hasPostgresCode(error, '40001')) throw error;
    }
  }
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
    throw new TypeError('B13.3 Agent operations cleanup URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B13.3 cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

async function cleanupFullFixture(runtime: DatabaseRuntime, ids: FixtureIds): Promise<void> {
  const pool = new Pool({
    application_name: 'qingxu-b133-agent-operations-cleanup',
    connectionString: fullCleanupConnectionString(),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orders = await client.query<{ id: string }>(
      'SELECT id::text FROM public.sales_order WHERE customer_id = $1',
      [ids.customerId],
    );
    const orderIds = orders.rows.map(({ id }) => id);
    const reservations = await client.query<{ id: string }>(
      'SELECT id::text FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    const reservationIds = reservations.rows.map(({ id }) => id);
    await client.query(
      'DELETE FROM public.inventory_ledger WHERE sku_id = $1 OR business_id::text = ANY($2::text[])',
      [ids.skuId, reservationIds],
    );
    await client.query(
      'DELETE FROM public.inventory_reservation_item WHERE reservation_id::text = ANY($1::text[])',
      [reservationIds],
    );
    await client.query(
      'DELETE FROM public.inventory_reservation WHERE id::text = ANY($1::text[])',
      [reservationIds],
    );
    for (const table of ['order_attribution_candidate', 'order_address_snapshot', 'order_item']) {
      await client.query(`DELETE FROM public.${table} WHERE order_id::text = ANY($1::text[])`, [orderIds]);
    }
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.binding_change_log WHERE customer_id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.customer_agent_binding WHERE customer_id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.customer_phone_verification WHERE customer_id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.customer_address WHERE customer_id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.customer_profile WHERE id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.inventory_balance WHERE id = $1', [ids.balanceId]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [ids.skuId]);
    await client.query('DELETE FROM public.product_image WHERE id = $1', [ids.imageId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [ids.productId]);
    await client.query('DELETE FROM public.file_asset WHERE id = $1', [ids.fileId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [ids.categoryId]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [ids.brandId]);
    await client.query('DELETE FROM public.agent_profile WHERE id::text = ANY($1::text[])', [
      [ids.agentAId, ids.agentBId],
    ]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [ids.accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  await assertNoFixtureFacts(runtime, ids);
}

databaseDescribe('B13.3 Agent operations PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('separates the current binding from immutable historical payment facts and rolls back cleanly', async () => {
    const ids = newFixtureIds();
    const now = new Date();

    try {
      await expect(runtime.withPrismaTransaction(async (transaction) => {
        await seedBaseFixture(transaction, ids, now);
        await seedHistoricalPayment(transaction, ids, now);
        const prisma = transactionBoundPrisma(transaction);
        const agents = new AgentOperationsRepository(prisma);
        const admin = new AdminCustomerRepository(prisma, Buffer.alloc(32, 13));
        const agentA = { accountId: ids.accountIds[0], agentId: ids.agentAId };
        const agentB = { accountId: ids.accountIds[1], agentId: ids.agentBId };

        await expect(agents.listCustomers({ ...agentA, page: 1, pageSize: 20 })).resolves.toMatchObject({
          items: [{
            bindingId: ids.bindingAId,
            city: 'Frozen City',
            consumptionAmount: '25.00',
            consumptionCount: 1,
            customerAlias: 'customer_b133_frozen',
            customerId: ids.customerId,
            nicknameMasked: 'F**',
            phoneTail: '9999',
          }],
          total: 1,
        });
        await expect(agents.getCustomer({ ...agentA, customerId: ids.customerId })).resolves.toMatchObject({
          customer: { bindingId: ids.bindingAId, consumptionAmount: '25.00', consumptionCount: 1 },
          orders: [{ orderId: ids.orderId }],
        });
        await expect(agents.getOrder({ ...agentA, orderId: ids.orderId })).resolves.toMatchObject({
          commissionItems: [{ originalCommission: '2.50', state: 'EXPECTED' }],
          customerAlias: 'customer_b133_frozen',
          customerCity: 'Frozen City',
          customerNicknameMasked: 'F**',
          customerPhoneTail: '1111',
          orderId: ids.orderId,
        });
        const historyBefore = await immutablePaymentFacts(transaction, ids);

        const transferred = await admin.transferAttributionInTransaction(transaction, {
          actorAccountId: ids.accountIds[3],
          customerId: ids.customerId,
          expectedVersion: 1,
          reason: 'B13.3 integration transfer to Agent B',
          targetAgentId: ids.agentBId,
        });
        expect(transferred).toMatchObject({
          afterBinding: { agentId: ids.agentBId, customerId: ids.customerId, customerVersion: 2 },
          beforeBinding: { agentId: ids.agentAId, bindingId: ids.bindingAId },
          invalidatedCandidateCount: 1,
        });

        await expect(agents.getCustomer({ ...agentA, customerId: ids.customerId })).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
        });
        await expect(agents.listCustomers({ ...agentA, page: 1, pageSize: 20 })).resolves.toEqual({
          items: [],
          total: 0,
        });
        await expect(agents.listOrders({
          ...agentA,
          page: 1,
          pageSize: 20,
          sort: 'CREATED_DESC',
        })).resolves.toMatchObject({ items: [{ orderId: ids.orderId }], total: 1 });
        await expect(agents.getOrder({ ...agentA, orderId: ids.orderId })).resolves.toMatchObject({
          customerAlias: 'customer_b133_frozen',
          customerCity: 'Frozen City',
          customerNicknameMasked: 'F**',
          customerPhoneTail: '1111',
          orderId: ids.orderId,
        });
        await expect(agents.listCustomers({ ...agentB, page: 1, pageSize: 20 })).resolves.toMatchObject({
          items: [{
            bindingId: transferred.afterBinding?.bindingId,
            consumptionAmount: '0.00',
            consumptionCount: 0,
            customerId: ids.customerId,
            lastProductName: null,
          }],
          total: 1,
        });
        await expect(agents.getCustomer({ ...agentB, customerId: ids.customerId })).resolves.toMatchObject({
          customer: { consumptionAmount: '0.00', consumptionCount: 0 },
          orders: [],
          recentProducts: [],
        });
        await expect(transaction.attributionCandidate.findUniqueOrThrow({
          where: { id: ids.activeCandidateId },
        })).resolves.toMatchObject({
          invalid_reason: 'ADMIN_ATTRIBUTION_TRANSFER',
          status: 'INVALIDATED',
        });
        expect(await immutablePaymentFacts(transaction, ids)).toEqual(historyBefore);

        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);
    } finally {
      await assertNoFixtureFacts(runtime, ids);
    }
  }, 90_000);

  fullIt.each(['ORDER_FIRST', 'TRANSFER_FIRST'] as const)(
    'serializes %s Store order creation with Admin attribution transfer without mixed facts',
    async (raceOrder: RaceOrder) => {
      const ids = newFixtureIds();
      const now = new Date();
      await runtime.withPrismaTransaction((transaction) => seedBaseFixture(transaction, ids, now), transactionOptions);
      const acquired = deferred<void>();
      const release = deferred<void>();
      const barrier: BindingLockBarrier = { acquired, intercepted: false, release };
      const orders = new StoreOrderRepository(runtime.prisma);
      const admin = new AdminCustomerRepository(runtime.prisma, Buffer.alloc(32, 13));
      const createOrder = (transaction: DatabaseTransaction) => orders.createOrderInTransaction(
        transaction,
        {
          accountId: ids.accountIds[2],
          addressId: ids.addressId,
          customerId: ids.customerId,
          items: [{ quantity: 1, skuId: ids.skuId }],
          source: 'BUY_NOW',
        },
        createOrderHooks(),
      );
      const transfer = (transaction: DatabaseTransaction) => admin.transferAttributionInTransaction(transaction, {
        actorAccountId: ids.accountIds[3],
        customerId: ids.customerId,
        expectedVersion: 1,
        reason: `B13.3 ${raceOrder} concurrency fixture`,
        targetAgentId: ids.agentBId,
      });
      let racing: {
        orderPromise: Promise<Awaited<ReturnType<typeof createOrder>>>;
        transferPromise: Promise<Awaited<ReturnType<typeof transfer>>>;
      } | undefined;

      try {
        if (raceOrder === 'ORDER_FIRST') {
          const orderPromise = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
            createOrder(transactionWithBindingBarrier(transaction, ids.customerId, barrier)));
          await barrier.acquired.promise;
          racing = {
            orderPromise,
            transferPromise: runSerializableWithoutDeadlockRetry(runtime, transfer),
          };
        } else {
          const transferPromise = runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
            transfer(transactionWithBindingBarrier(transaction, ids.customerId, barrier)));
          await barrier.acquired.promise;
          racing = {
            orderPromise: runSerializableWithoutDeadlockRetry(runtime, createOrder),
            transferPromise,
          };
        }
        const blockedCount = await observeBlockedAdvisoryLockPairs(runtime);
        release.resolve();
        const [orderResult, transferResult] = await Promise.all([
          racing.orderPromise,
          racing.transferPromise,
        ]);
        expect(blockedCount).toBeGreaterThan(0);
        if (transferResult.afterBinding === null) {
          throw new TypeError('B13.3 race returned an invalid repository result');
        }
        const expected = raceOrder === 'ORDER_FIRST'
          ? { agentId: ids.agentAId, bindingId: ids.bindingAId }
          : { agentId: ids.agentBId, bindingId: transferResult.afterBinding.bindingId };
        await expect(runtime.prisma.orderAttributionCandidate.findUniqueOrThrow({
          where: { order_id: orderResult.order.orderId },
        })).resolves.toMatchObject({
          binding_id: expected.bindingId,
          candidate_agent_id: expected.agentId,
          submit_channel: 'AGENT',
        });
        await expect(runtime.prisma.customerAgentBinding.findFirstOrThrow({
          where: { customer_id: ids.customerId, ended_at: null },
        })).resolves.toMatchObject({ agent_id: ids.agentBId, id: transferResult.afterBinding.bindingId });
      } finally {
        release.resolve();
        if (racing !== undefined) {
          await Promise.allSettled([racing.orderPromise, racing.transferPromise]);
        }
        await cleanupFullFixture(runtime, ids);
      }
    },
    90_000,
  );
});
