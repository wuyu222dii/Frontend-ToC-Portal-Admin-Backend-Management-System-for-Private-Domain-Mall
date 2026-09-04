import { createHash, randomBytes } from 'node:crypto';

import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import { AgentFinanceRepository, type ReplaceAgentBankAccountInput } from './agent-finance.repository';
import { validateAgentCommissionLedgerClosureInTransaction } from './commission.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { isRetryableTransactionError } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B135_AGENT_FINANCE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B135_AGENT_FINANCE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B135_AGENT_FINANCE_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  accountIds: [string, string, string];
  agentId: string;
  attributionSnapshotId: string;
  availableLedgerId: string;
  bankAccountIds: [string, string];
  brandId: string;
  businessRuleId: string;
  categoryId: string;
  commissionEntryId: string;
  commissionPositionId: string;
  commissionRuleId: string;
  commissionSnapshotId: string;
  creditAttributionSnapshotId: string;
  creditAvailableLedgerId: string;
  creditCommissionPositionId: string;
  creditCommissionSnapshotId: string;
  creditExpectedLedgerId: string;
  creditOrderId: string;
  creditOrderItemId: string;
  customerId: string;
  expectedLedgerId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  refundId: string;
  refundItemId: string;
  refundLedgerId: string;
  skuId: string;
  walletId: string;
  withdrawalIds: [string, string];
}

interface SeededFixture {
  minimum: Prisma.Decimal;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface WalletLockBarrier {
  acquired: Deferred<void>;
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
  if (!value) throw new TypeError(`${name} is required for B13.5 Agent finance database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.5 Agent finance tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let databaseName: string;
    let username: string;
    try {
      databaseName = decodeURIComponent(url.pathname.slice(1));
      username = decodeURIComponent(url.username);
    } catch {
      throw new TypeError('B13.5 Agent finance DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.5 Agent finance tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b135-agent-finance-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.5 Agent finance tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b135-agent-finance-rollback',
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
    throw new TypeError('B13.5 Agent finance cleanup URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B13.5 cleanup requires the matching loopback mall_migrator test database');
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

function newFixtureIds(): FixtureIds {
  const id = (): string => generateUlid();
  return {
    accountIds: [id(), id(), id()],
    agentId: id(),
    attributionSnapshotId: id(),
    availableLedgerId: id(),
    bankAccountIds: [id(), id()],
    brandId: id(),
    businessRuleId: id(),
    categoryId: id(),
    commissionEntryId: id(),
    commissionPositionId: id(),
    commissionRuleId: id(),
    commissionSnapshotId: id(),
    creditAttributionSnapshotId: id(),
    creditAvailableLedgerId: id(),
    creditCommissionPositionId: id(),
    creditCommissionSnapshotId: id(),
    creditExpectedLedgerId: id(),
    creditOrderId: id(),
    creditOrderItemId: id(),
    customerId: id(),
    expectedLedgerId: id(),
    orderId: id(),
    orderItemId: id(),
    productId: id(),
    refundId: id(),
    refundItemId: id(),
    refundLedgerId: id(),
    skuId: id(),
    walletId: id(),
    withdrawalIds: [id(), id()],
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bankInput(
  ids: FixtureIds,
  index: 0 | 1,
  ciphertext: Uint8Array,
): ReplaceAgentBankAccountInput {
  const accountNumber = index === 0 ? '1234567890123456' : '9876543210987654';
  const accountHash = digest(`b135-bank-hmac:${accountNumber}`);
  return {
    accountHash,
    accountHashCandidates: [accountHash],
    accountHolder: index === 0 ? 'B13.5 Agent Holder' : 'B13.5 Replacement Holder',
    accountId: ids.accountIds[1],
    agentId: ids.agentId,
    bankAccountId: ids.bankAccountIds[index],
    bankName: index === 0 ? 'B13.5 Fixture Bank' : 'B13.5 Replacement Bank',
    ciphertext,
    encryptionKeyId: 'b135-field-key-v1',
    last4: accountNumber.slice(-4),
  };
}

async function seedFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  now: Date,
): Promise<SeededFixture> {
  const [adminAccountId, agentAccountId, customerAccountId] = ids.accountIds;
  await transaction.account.createMany({
    data: [
      {
        created_at: now,
        id: adminAccountId,
        login_name: `b135-admin-${adminAccountId}`,
        must_change_password: false,
        password_hash: 'b135-fixture-password-hash',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: agentAccountId,
        login_name: `b135-agent-${agentAccountId}`,
        must_change_password: false,
        password_hash: 'b135-fixture-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: customerAccountId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
        wechat_open_id: `b135-customer-${customerAccountId}`,
      },
    ],
  });
  await transaction.agentProfile.create({
    data: {
      account_id: agentAccountId,
      agent_no: `B135-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B13.5 Integration Agent',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: customerAccountId,
      created_at: now,
      id: ids.customerId,
      nickname: 'B13.5 Integration Customer',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });

  const currentRules = await transaction.businessRuleVersion.findMany({
    orderBy: [{ effective_at: 'desc' }, { version_no: 'desc' }, { id: 'desc' }],
    select: { id: true, minimum_withdrawal_amount: true },
    where: { effective_at: { lte: now }, status: 'PUBLISHED' },
  });
  if (currentRules.length > 1) throw new Error('B13.5 fixture found multiple effective published business rules');
  let minimum = currentRules[0]?.minimum_withdrawal_amount;
  if (minimum === undefined) {
    const maximum = await transaction.businessRuleVersion.aggregate({ _max: { version_no: true } });
    minimum = new Prisma.Decimal('100.00');
    await transaction.businessRuleVersion.create({
      data: {
        aftersale_window_days: 7,
        created_at: now,
        created_by_id: adminAccountId,
        effective_at: new Date(now.getTime() - 60_000),
        id: ids.businessRuleId,
        legal_record_retention_years: 10,
        minimum_withdrawal_amount: minimum,
        order_payment_timeout_minutes: 30,
        reason: 'B13.5 withdrawal integration rule',
        status: 'PUBLISHED',
        version_no: (maximum._max.version_no ?? 0) + 1,
      },
    });
  }

  await transaction.brand.create({
    data: {
      created_at: now,
      id: ids.brandId,
      name: `B13.5 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: ids.categoryId,
      name: `B13.5 Category ${ids.categoryId}`,
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
      name: 'B13.5 Fixture Product',
      published_at: now,
      spu_code: `B135-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B135-SKU-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B13.5 Fixture SKU',
      product_id: ids.productId,
      retail_price: minimum,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });

  const paidAt = new Date(now.getTime() - 30_000);
  const orderCreatedAt = new Date(paidAt.getTime() - 60_000);
  await transaction.salesOrder.create({
    data: {
      created_at: orderCreatedAt,
      customer_id: ids.customerId,
      final_agent_id: ids.agentId,
      final_channel: 'AGENT',
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: minimum,
      id: ids.orderId,
      order_no: `B135${ids.orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: minimum,
      paid_at: paidAt,
      pay_expires_at: new Date(orderCreatedAt.getTime() + 1_800_000),
      payable_amount: minimum,
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
      brand_name_snapshot: `B13.5 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B13.5 Category ${ids.categoryId}`,
      created_at: paidAt,
      id: ids.orderItemId,
      line_paid_amount: minimum,
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: 'B13.5 Fixture Product',
      quantity: 1,
      sku_code_snapshot: `B135-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B13.5 Fixture SKU',
      unit_price: minimum,
      version: 1,
    },
  });
  await transaction.orderAttributionSnapshot.create({
    data: {
      agent_id_snapshot: ids.agentId,
      captured_at: paidAt,
      final_channel: 'AGENT',
      id: ids.attributionSnapshotId,
      order_id: ids.orderId,
    },
  });
  const creditOrderCreatedAt = new Date(paidAt.getTime() - 59_000);
  await transaction.salesOrder.create({
    data: {
      created_at: creditOrderCreatedAt,
      customer_id: ids.customerId,
      final_agent_id: ids.agentId,
      final_channel: 'AGENT',
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: minimum,
      id: ids.creditOrderId,
      order_no: `B135${ids.creditOrderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: minimum,
      paid_at: new Date(paidAt.getTime() + 1_000),
      pay_expires_at: new Date(creditOrderCreatedAt.getTime() + 1_800_000),
      payable_amount: minimum,
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: '0.00',
      shipping_amount: '0.00',
      source: 'BUY_NOW',
      updated_at: new Date(paidAt.getTime() + 1_000),
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      brand_name_snapshot: `B13.5 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B13.5 Category ${ids.categoryId}`,
      created_at: new Date(paidAt.getTime() + 1_000),
      id: ids.creditOrderItemId,
      line_paid_amount: minimum,
      order_id: ids.creditOrderId,
      product_id: ids.productId,
      product_name_snapshot: 'B13.5 Fixture Product',
      quantity: 1,
      sku_code_snapshot: `B135-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B13.5 Fixture SKU',
      unit_price: minimum,
      version: 1,
    },
  });
  await transaction.orderAttributionSnapshot.create({
    data: {
      agent_id_snapshot: ids.agentId,
      captured_at: new Date(paidAt.getTime() + 1_000),
      final_channel: 'AGENT',
      id: ids.creditAttributionSnapshotId,
      order_id: ids.creditOrderId,
    },
  });

  const maximumCommissionRule = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
  await transaction.commissionRuleVersion.create({
    data: {
      created_at: new Date(paidAt.getTime() - 60_000),
      created_by_id: adminAccountId,
      effective_at: new Date(paidAt.getTime() - 60_000),
      id: ids.commissionRuleId,
      reason: 'B13.5 available commission fixture',
      status: 'DRAFT',
      version_no: (maximumCommissionRule._max.version_no ?? 0) + 1,
    },
  });
  await transaction.commissionRuleEntry.create({
    data: {
      configured_rate: '100.0000',
      created_at: new Date(paidAt.getTime() - 60_000),
      id: ids.commissionEntryId,
      rule_version_id: ids.commissionRuleId,
      target_id: null,
      target_key: 'PLATFORM',
      target_type: 'PLATFORM',
    },
  });
  await transaction.commissionRuleVersion.update({
    data: { status: 'ARCHIVED' },
    where: { id: ids.commissionRuleId },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: `B13.5 Category ${ids.categoryId}`,
      commission_base: minimum,
      created_at: paidAt,
      effective_rate: '100.0000',
      id: ids.commissionSnapshotId,
      order_item_id: ids.orderItemId,
      original_commission: minimum,
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleId,
      sku_id_snapshot: ids.skuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      available_at: paidAt,
      expected_remaining: '0.00',
      id: ids.commissionPositionId,
      original_commission: minimum,
      reversed_total: '0.00',
      snapshot_id: ids.commissionSnapshotId,
      state: 'AVAILABLE',
      updated_at: paidAt,
      version: 1,
    },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: `B13.5 Category ${ids.categoryId}`,
      commission_base: minimum,
      created_at: new Date(paidAt.getTime() + 1_000),
      effective_rate: '100.0000',
      id: ids.creditCommissionSnapshotId,
      order_item_id: ids.creditOrderItemId,
      original_commission: minimum,
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleId,
      sku_id_snapshot: ids.skuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      available_at: null,
      expected_remaining: minimum,
      id: ids.creditCommissionPositionId,
      original_commission: minimum,
      reversed_total: '0.00',
      snapshot_id: ids.creditCommissionSnapshotId,
      state: 'EXPECTED',
      updated_at: new Date(paidAt.getTime() + 1_000),
      version: 1,
    },
  });
  await transaction.commissionLedger.createMany({
    data: [
      {
        agent_id: ids.agentId,
        available_change: '0.00',
        expected_change: minimum,
        frozen_change: '0.00',
        id: ids.expectedLedgerId,
        idempotency_key: `b135:expected:${ids.commissionSnapshotId}`,
        ledger_type: 'EXPECTED_CREATED',
        occurred_at: paidAt,
        reason: 'B13.5_COMMISSION_CREATED',
        snapshot_id: ids.commissionSnapshotId,
      },
      {
        agent_id: ids.agentId,
        available_change: minimum,
        expected_change: minimum.negated(),
        frozen_change: '0.00',
        id: ids.availableLedgerId,
        idempotency_key: `b135:available:${ids.commissionSnapshotId}`,
        ledger_type: 'AVAILABLE_CREDIT',
        occurred_at: new Date(paidAt.getTime() + 1),
        reason: 'B13.5_ORDER_COMPLETED',
        snapshot_id: ids.commissionSnapshotId,
      },
      {
        agent_id: ids.agentId,
        available_change: '0.00',
        expected_change: minimum,
        frozen_change: '0.00',
        id: ids.creditExpectedLedgerId,
        idempotency_key: `b135:expected:${ids.creditCommissionSnapshotId}`,
        ledger_type: 'EXPECTED_CREATED',
        occurred_at: new Date(paidAt.getTime() + 1_000),
        reason: 'B13.5_PENDING_COMMISSION_CREATED',
        snapshot_id: ids.creditCommissionSnapshotId,
      },
    ],
  });
  await transaction.agentWallet.create({
    data: {
      agent_id: ids.agentId,
      available_balance: minimum,
      frozen_balance: '0.00',
      id: ids.walletId,
      updated_at: now,
      version: 1,
    },
  });
  return { minimum };
}

async function assertFixtureAbsent(runtime: DatabaseRuntime, ids: FixtureIds): Promise<void> {
  const counts = await Promise.all([
    runtime.prisma.withdrawalBankSnapshot.count({ where: { withdrawal: { agent_id: ids.agentId } } }),
    runtime.prisma.withdrawal.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.agentBankAccount.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.refundItem.count({ where: { refund_id: ids.refundId } }),
    runtime.prisma.refund.count({ where: { id: ids.refundId } }),
    runtime.prisma.commissionLedger.count({ where: { agent_id: ids.agentId } }),
    runtime.prisma.orderItemCommissionPosition.count({
      where: { id: { in: [ids.commissionPositionId, ids.creditCommissionPositionId] } },
    }),
    runtime.prisma.orderItemCommissionSnapshot.count({
      where: { id: { in: [ids.commissionSnapshotId, ids.creditCommissionSnapshotId] } },
    }),
    runtime.prisma.commissionRuleEntry.count({ where: { id: ids.commissionEntryId } }),
    runtime.prisma.commissionRuleVersion.count({ where: { id: ids.commissionRuleId } }),
    runtime.prisma.agentWallet.count({ where: { id: ids.walletId } }),
    runtime.prisma.orderAttributionSnapshot.count({
      where: { id: { in: [ids.attributionSnapshotId, ids.creditAttributionSnapshotId] } },
    }),
    runtime.prisma.orderItem.count({ where: { id: { in: [ids.orderItemId, ids.creditOrderItemId] } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: [ids.orderId, ids.creditOrderId] } } }),
    runtime.prisma.sku.count({ where: { id: ids.skuId } }),
    runtime.prisma.product.count({ where: { id: ids.productId } }),
    runtime.prisma.category.count({ where: { id: ids.categoryId } }),
    runtime.prisma.brand.count({ where: { id: ids.brandId } }),
    runtime.prisma.businessRuleVersion.count({ where: { id: ids.businessRuleId } }),
    runtime.prisma.agentProfile.count({ where: { id: ids.agentId } }),
    runtime.prisma.customerProfile.count({ where: { id: ids.customerId } }),
    runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } }),
  ]);
  expect(counts).toEqual(Array.from({ length: counts.length }, () => 0));
}

async function cleanupFullFixture(connectionString: string, ids: FixtureIds): Promise<void> {
  const pool = new Pool({
    application_name: 'qingxu-b135-agent-finance-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public.commission_ledger WHERE agent_id = $1', [ids.agentId]);
    await client.query(
      'DELETE FROM public.withdrawal_bank_snapshot WHERE withdrawal_id IN (SELECT id FROM public.withdrawal WHERE agent_id = $1)',
      [ids.agentId],
    );
    await client.query('DELETE FROM public.withdrawal WHERE agent_id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.agent_bank_account WHERE agent_id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.refund_item WHERE refund_id = $1', [ids.refundId]);
    await client.query('DELETE FROM public.refund WHERE id = $1', [ids.refundId]);
    await client.query('DELETE FROM public.order_item_commission_position WHERE id::text = ANY($1::text[])', [[
      ids.commissionPositionId,
      ids.creditCommissionPositionId,
    ]]);
    await client.query('DELETE FROM public.order_item_commission_snapshot WHERE id::text = ANY($1::text[])', [[
      ids.commissionSnapshotId,
      ids.creditCommissionSnapshotId,
    ]]);
    await client.query('ALTER TABLE public.commission_rule_entry DISABLE TRIGGER trg_commission_rule_entry_append_only');
    await client.query('DELETE FROM public.commission_rule_entry WHERE id = $1', [ids.commissionEntryId]);
    await client.query('ALTER TABLE public.commission_rule_entry ENABLE TRIGGER trg_commission_rule_entry_append_only');
    await client.query('DELETE FROM public.commission_rule_version WHERE id = $1', [ids.commissionRuleId]);
    await client.query('DELETE FROM public.agent_wallet WHERE id = $1', [ids.walletId]);
    await client.query('DELETE FROM public.order_attribution_snapshot WHERE id::text = ANY($1::text[])', [[
      ids.attributionSnapshotId,
      ids.creditAttributionSnapshotId,
    ]]);
    await client.query('DELETE FROM public.order_item WHERE id::text = ANY($1::text[])', [[
      ids.orderItemId,
      ids.creditOrderItemId,
    ]]);
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [[
      ids.orderId,
      ids.creditOrderId,
    ]]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [ids.skuId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [ids.productId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [ids.categoryId]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [ids.brandId]);
    await client.query('DELETE FROM public.business_rule_version WHERE id = $1', [ids.businessRuleId]);
    await client.query('DELETE FROM public.agent_profile WHERE id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.customer_profile WHERE id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [ids.accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function runSerializableWithRetry<T>(
  runtime: DatabaseRuntime,
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runtime.withPrismaTransaction(work, transactionOptions);
    } catch (error) {
      if (attempt >= 5 || !isRetryableTransactionError(error)) throw error;
    }
  }
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

async function waitForBarrier<T>(barrier: WalletLockBarrier, operation: Promise<T>, label: string): Promise<void> {
  await Promise.race([
    barrier.acquired.promise,
    operation.then(
      () => { throw new Error(`${label} completed before holding the wallet lock`); },
      (error: unknown) => { throw error; },
    ),
  ]);
}

async function makeExpectedCommissionAvailable(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  amount: Prisma.Decimal,
  barrier: WalletLockBarrier,
): Promise<void> {
  await acquireTransactionLock(transaction, 'agent-wallet', [ids.agentId]);
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM public.agent_wallet WHERE agent_id = ${ids.agentId} FOR UPDATE
  `);
  if (locked.length !== 1 || locked[0]?.id !== ids.walletId) throw new Error('B13.5 fixture wallet is missing');
  const wallet = await transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } });
  barrier.acquired.resolve();
  await barrier.release.promise;

  const occurredAt = new Date();
  const changedPosition = await transaction.orderItemCommissionPosition.updateMany({
    data: {
      available_at: occurredAt,
      expected_remaining: '0.00',
      state: 'AVAILABLE',
      updated_at: occurredAt,
      version: { increment: 1 },
    },
    where: {
      expected_remaining: amount,
      id: ids.creditCommissionPositionId,
      state: 'EXPECTED',
      version: 1,
    },
  });
  if (changedPosition.count !== 1) throw new Error('B13.5 fixture commission position changed concurrently');
  await transaction.commissionLedger.create({
    data: {
      agent_id: ids.agentId,
      available_change: amount,
      expected_change: amount.negated(),
      frozen_change: '0.00',
      id: ids.creditAvailableLedgerId,
      idempotency_key: `b135:available:${ids.creditCommissionSnapshotId}`,
      ledger_type: 'AVAILABLE_CREDIT',
      occurred_at: occurredAt,
      reason: 'B13.5_CONCURRENT_COMMISSION_AVAILABLE',
      snapshot_id: ids.creditCommissionSnapshotId,
    },
  });
  const changedWallet = await transaction.agentWallet.updateMany({
    data: {
      available_balance: wallet.available_balance.add(amount),
      updated_at: occurredAt,
      version: { increment: 1 },
    },
    where: {
      available_balance: wallet.available_balance,
      frozen_balance: wallet.frozen_balance,
      id: ids.walletId,
      version: wallet.version,
    },
  });
  if (changedWallet.count !== 1) throw new Error('B13.5 fixture wallet changed concurrently');
  await validateAgentCommissionLedgerClosureInTransaction(transaction, ids.agentId);
}

function transactionWithWalletBarrier(
  transaction: DatabaseTransaction,
  agentId: string,
  barrier: WalletLockBarrier,
): DatabaseTransaction {
  let intercepted = false;
  return new Proxy(transaction, {
    get(target, property) {
      if (property === '$queryRawUnsafe') {
        return async (query: string, ...values: unknown[]) => {
          const result = await target.$queryRawUnsafe(query, ...values);
          if (!intercepted && query.includes('pg_advisory_xact_lock') && values[0] === 'agent-wallet' &&
            values[1] === JSON.stringify([agentId])) {
            intercepted = true;
            barrier.acquired.resolve();
            await barrier.release.promise;
          }
          return result as unknown;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function reverseAvailableCommissionForRefund(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  amount: Prisma.Decimal,
  barrier?: WalletLockBarrier,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT id FROM public.sales_order WHERE id = ${ids.orderId} FOR UPDATE
  `);
  await transaction.$queryRaw(Prisma.sql`
    SELECT id FROM public.order_item_commission_position
    WHERE id = ${ids.commissionPositionId} FOR UPDATE
  `);
  await acquireTransactionLock(transaction, 'agent-wallet', [ids.agentId]);
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM public.agent_wallet WHERE agent_id = ${ids.agentId} FOR UPDATE
  `);
  if (locked.length !== 1 || locked[0]?.id !== ids.walletId) throw new Error('B13.5 fixture wallet is missing');
  const [position, wallet] = await Promise.all([
    transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.commissionPositionId } }),
    transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } }),
  ]);
  barrier?.acquired.resolve();
  if (barrier) await barrier.release.promise;

  const occurredAt = new Date();
  await transaction.refund.create({
    data: {
      amount,
      id: ids.refundId,
      is_late_payment_refund: true,
      order_id: ids.orderId,
      origin_type: 'LATE_PAYMENT',
      provider: 'MOCK',
      provider_refund_id: `b135-refund-${ids.refundId}`,
      reason: 'B13.5 concurrent refund commission reversal',
      refund_no: `RF${ids.refundId}`,
      requested_at: occurredAt,
      status: 'SUCCEEDED',
      succeeded_at: occurredAt,
      updated_at: occurredAt,
      version: 1,
    },
  });
  await transaction.refundItem.create({
    data: {
      amount,
      commission_reversal: amount,
      created_at: occurredAt,
      id: ids.refundItemId,
      order_item_id: ids.orderItemId,
      quantity: 1,
      refund_id: ids.refundId,
    },
  });
  const changedPosition = await transaction.orderItemCommissionPosition.updateMany({
    data: { reversed_total: position.reversed_total.add(amount), updated_at: occurredAt, version: { increment: 1 } },
    where: {
      id: ids.commissionPositionId,
      reversed_total: position.reversed_total,
      state: 'AVAILABLE',
      version: position.version,
    },
  });
  if (changedPosition.count !== 1) throw new Error('B13.5 fixture refund position changed concurrently');
  await transaction.commissionLedger.create({
    data: {
      agent_id: ids.agentId,
      available_change: amount.negated(),
      expected_change: '0.00',
      frozen_change: '0.00',
      id: ids.refundLedgerId,
      idempotency_key: `refund:${ids.refundId}:${ids.commissionSnapshotId}`,
      ledger_type: 'REFUND_DEBIT',
      occurred_at: occurredAt,
      reason: 'B13.5_CONCURRENT_REFUND_REVERSAL',
      refund_id: ids.refundId,
      snapshot_id: ids.commissionSnapshotId,
    },
  });
  const changedWallet = await transaction.agentWallet.updateMany({
    data: {
      available_balance: wallet.available_balance.sub(amount),
      updated_at: occurredAt,
      version: { increment: 1 },
    },
    where: {
      available_balance: wallet.available_balance,
      frozen_balance: wallet.frozen_balance,
      id: ids.walletId,
      version: wallet.version,
    },
  });
  if (changedWallet.count !== 1) throw new Error('B13.5 fixture refund wallet changed concurrently');
  await validateAgentCommissionLedgerClosureInTransaction(transaction, ids.agentId);
}

databaseDescribe('B13.5 Agent finance PostgreSQL integration', () => {
  let cleanupConnectionString: string | undefined;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    if (mode === 'full') cleanupConnectionString = fullCleanupConnectionString();
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('rolls back encrypted bank replacement and a minimum-sized frozen withdrawal exactly', async () => {
    const ids = newFixtureIds();
    const now = new Date();
    const ciphertext = randomBytes(48);
    try {
      await expect(runtime.withPrismaTransaction(async (transaction) => {
        const seeded = await seedFixture(transaction, ids, now);
        const repository = new AgentFinanceRepository(transactionBoundPrisma(transaction), () => now);
        const bank = await repository.replaceBankAccountInTransaction(transaction, bankInput(ids, 0, ciphertext));
        expect(bank).toMatchObject({ changed: true, bankAccount: { bankAccountId: ids.bankAccountIds[0], last4: '3456' } });

        const withdrawal = await repository.createWithdrawalInTransaction(transaction, {
          accountId: ids.accountIds[1],
          agentId: ids.agentId,
          amount: seeded.minimum.toFixed(2),
          bankAccountId: ids.bankAccountIds[0],
          withdrawalId: ids.withdrawalIds[0],
        });
        expect(withdrawal).toMatchObject({
          amount: seeded.minimum.toFixed(2),
          bankAccountLast4: '3456',
          status: 'PENDING',
          withdrawalId: ids.withdrawalIds[0],
        });
        await expect(transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } })).resolves.toMatchObject({
          available_balance: new Prisma.Decimal('0.00'),
          frozen_balance: seeded.minimum,
          version: 2,
        });
        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);
    } finally {
      await assertFixtureAbsent(runtime, ids);
    }
  }, 120_000);

  fullIt('serializes commission credit with one in-flight withdrawal and preserves its bank snapshot',
    async () => {
      if (cleanupConnectionString === undefined) throw new TypeError('B13.5 cleanup was not initialized');
      const ids = newFixtureIds();
      const now = new Date();
      const firstCiphertext = randomBytes(48);
      const replacementCiphertext = randomBytes(48);
      try {
        const seeded = await runtime.withPrismaTransaction(
          (transaction) => seedFixture(transaction, ids, now),
          transactionOptions,
        );
        const repository = new AgentFinanceRepository(runtime.prisma);
        await runtime.withPrismaTransaction(
          (transaction) => repository.replaceBankAccountInTransaction(transaction, bankInput(ids, 0, firstCiphertext)),
          transactionOptions,
        );

        const storedBank = await runtime.prisma.agentBankAccount.findUniqueOrThrow({
          where: { id: ids.bankAccountIds[0] },
        });
        expect(Buffer.from(storedBank.account_no_ciphertext).equals(Buffer.from(firstCiphertext))).toBe(true);
        expect(storedBank.account_no_hash).toBe(bankInput(ids, 0, firstCiphertext).accountHash);
        expect(Buffer.from(storedBank.account_no_ciphertext).toString('utf8')).not.toContain('1234567890123456');
        const listedBanks = await repository.listBankAccounts({
          accountId: ids.accountIds[1],
          agentId: ids.agentId,
        });
        expect(listedBanks).toEqual([
          expect.objectContaining({ bankAccountId: ids.bankAccountIds[0], last4: '3456' }),
        ]);
        expect(JSON.stringify(listedBanks)).not.toMatch(/1234567890123456|ciphertext|accountHash/i);

        if (seeded.minimum.greaterThan('0.01')) {
          await expect(runtime.withPrismaTransaction((transaction) => repository.createWithdrawalInTransaction(
            transaction,
            {
              accountId: ids.accountIds[1],
              agentId: ids.agentId,
              amount: seeded.minimum.minus('0.01').toFixed(2),
              bankAccountId: ids.bankAccountIds[0],
              withdrawalId: generateUlid(),
            },
          ), transactionOptions)).rejects.toMatchObject({ code: 'WITHDRAWAL_MINIMUM_NOT_MET' });
        }

        const create = (withdrawalId: string) => runSerializableWithRetry(runtime, (transaction) =>
          repository.createWithdrawalInTransaction(transaction, {
            accountId: ids.accountIds[1],
            agentId: ids.agentId,
            amount: seeded.minimum.toFixed(2),
            bankAccountId: ids.bankAccountIds[0],
            withdrawalId,
          }));
        const barrier: WalletLockBarrier = { acquired: deferred(), release: deferred() };
        const creditOperation = runtime.withPrismaTransaction(
          (transaction) => makeExpectedCommissionAvailable(transaction, ids, seeded.minimum, barrier),
          transactionOptions,
        );
        let outcomes: PromiseSettledResult<Awaited<ReturnType<typeof create>>>[];
        let withdrawalOperations: Promise<Awaited<ReturnType<typeof create>>>[] = [];
        try {
          await waitForBarrier(barrier, creditOperation, 'Commission credit');
          withdrawalOperations = [create(ids.withdrawalIds[0])];
          expect(await observeBlockedAdvisoryLockPairs(runtime)).toBeGreaterThan(0);
          withdrawalOperations.push(create(ids.withdrawalIds[1]));
          barrier.release.resolve();
          await creditOperation;
          outcomes = await Promise.allSettled(withdrawalOperations);
        } finally {
          barrier.release.resolve();
          await Promise.allSettled([creditOperation, ...withdrawalOperations]);
        }
        const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof create>>> =>
          outcome.status === 'fulfilled');
        const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toBeInstanceOf(ApplicationError);
        expect(rejected[0]?.reason).toMatchObject({ code: 'WITHDRAWAL_IN_PROGRESS' });

        const withdrawal = fulfilled[0]!.value;
        const losingWithdrawalId = ids.withdrawalIds.find((id) => id !== withdrawal.withdrawalId)!;
        await expect(runtime.prisma.withdrawal.count({ where: { id: losingWithdrawalId } })).resolves.toBe(0);
        await expect(runtime.prisma.withdrawal.count({
          where: { agent_id: ids.agentId, status: { in: ['PENDING', 'APPROVED'] } },
        })).resolves.toBe(1);
        await expect(runtime.prisma.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } })).resolves.toMatchObject({
          available_balance: seeded.minimum,
          frozen_balance: seeded.minimum,
          version: 3,
        });
        await expect(runtime.prisma.commissionLedger.findFirstOrThrow({
          where: { ledger_type: 'WITHDRAWAL_FREEZE', withdrawal_id: withdrawal.withdrawalId },
        })).resolves.toMatchObject({
          available_change: seeded.minimum.negated(),
          expected_change: new Prisma.Decimal('0.00'),
          frozen_change: seeded.minimum,
        });
        const ledgerTotals = await runtime.prisma.commissionLedger.aggregate({
          _sum: { available_change: true, expected_change: true, frozen_change: true },
          where: { agent_id: ids.agentId },
        });
        expect(ledgerTotals._sum).toEqual({
          available_change: seeded.minimum,
          expected_change: new Prisma.Decimal('0.00'),
          frozen_change: seeded.minimum,
        });
        await expect(runtime.prisma.orderItemCommissionPosition.findUniqueOrThrow({
          where: { id: ids.creditCommissionPositionId },
        })).resolves.toMatchObject({
          expected_remaining: new Prisma.Decimal('0.00'),
          state: 'AVAILABLE',
          version: 2,
        });

        const snapshotBefore = await runtime.prisma.withdrawalBankSnapshot.findUniqueOrThrow({
          where: { withdrawal_id: withdrawal.withdrawalId },
        });
        expect(snapshotBefore).toMatchObject({
          account_holder: 'B13.5 Agent Holder',
          account_no_last4: '3456',
          bank_name: 'B13.5 Fixture Bank',
          encryption_key_id: 'b135-field-key-v1',
          source_bank_account_id: ids.bankAccountIds[0],
        });
        expect(Buffer.from(snapshotBefore.account_no_ciphertext).equals(Buffer.from(firstCiphertext))).toBe(true);
        await expect(runtime.prisma.withdrawalBankSnapshot.update({
          data: { bank_name: 'Changed Bank' },
          where: { withdrawal_id: withdrawal.withdrawalId },
        })).rejects.toBeDefined();

        await runtime.withPrismaTransaction(
          (transaction) => repository.replaceBankAccountInTransaction(
            transaction,
            bankInput(ids, 1, replacementCiphertext),
          ),
          transactionOptions,
        );
        await expect(runtime.prisma.agentBankAccount.findUniqueOrThrow({
          where: { id: ids.bankAccountIds[0] },
        })).resolves.toMatchObject({ deleted_at: expect.any(Date), is_active: false, version: 2 });
        await expect(repository.getWithdrawal({
          accountId: ids.accountIds[1],
          agentId: ids.agentId,
          withdrawalId: withdrawal.withdrawalId,
        })).resolves.toMatchObject({ bankAccountLast4: '3456', status: 'PENDING' });
        await expect(repository.listWithdrawals({
          accountId: ids.accountIds[1],
          agentId: ids.agentId,
          page: 1,
          pageSize: 20,
        })).resolves.toMatchObject({ items: [expect.objectContaining({ withdrawalId: withdrawal.withdrawalId })], total: 1 });
      } finally {
        await cleanupFullFixture(cleanupConnectionString, ids);
        await assertFixtureAbsent(runtime, ids);
      }
    }, 180_000);

  fullIt('serializes refund reversal and withdrawal in both wallet-lock orders without losing money facts',
    async () => {
      if (cleanupConnectionString === undefined) throw new TypeError('B13.5 cleanup was not initialized');
      for (const order of ['REFUND_FIRST', 'WITHDRAWAL_FIRST'] as const) {
        const ids = newFixtureIds();
        const now = new Date();
        try {
          const seeded = await runtime.withPrismaTransaction(
            (transaction) => seedFixture(transaction, ids, now),
            transactionOptions,
          );
          const repository = new AgentFinanceRepository(runtime.prisma);
          await runtime.withPrismaTransaction(
            (transaction) => repository.replaceBankAccountInTransaction(
              transaction,
              bankInput(ids, 0, randomBytes(48)),
            ),
            transactionOptions,
          );
          const withdrawalInput = {
            accountId: ids.accountIds[1],
            agentId: ids.agentId,
            amount: seeded.minimum.toFixed(2),
            bankAccountId: ids.bankAccountIds[0],
            withdrawalId: ids.withdrawalIds[0],
          };
          const barrier: WalletLockBarrier = { acquired: deferred(), release: deferred() };
          let withdrawalOperation: Promise<Awaited<ReturnType<typeof repository.createWithdrawalInTransaction>>>;
          let refundOperation: Promise<void>;
          if (order === 'REFUND_FIRST') {
            refundOperation = runSerializableWithRetry(runtime, (transaction) =>
              reverseAvailableCommissionForRefund(transaction, ids, seeded.minimum, barrier));
            await waitForBarrier(barrier, refundOperation, 'Refund reversal');
            withdrawalOperation = runSerializableWithRetry(runtime, (transaction) =>
              repository.createWithdrawalInTransaction(transaction, withdrawalInput));
          } else {
            withdrawalOperation = runSerializableWithRetry(runtime, (transaction) =>
              repository.createWithdrawalInTransaction(
                transactionWithWalletBarrier(transaction, ids.agentId, barrier),
                withdrawalInput,
              ));
            await waitForBarrier(barrier, withdrawalOperation, 'Withdrawal');
            refundOperation = runSerializableWithRetry(runtime, (transaction) =>
              reverseAvailableCommissionForRefund(transaction, ids, seeded.minimum));
          }

          let outcomes: [PromiseSettledResult<Awaited<typeof withdrawalOperation>>, PromiseSettledResult<void>];
          try {
            expect(await observeBlockedAdvisoryLockPairs(runtime)).toBeGreaterThan(0);
            barrier.release.resolve();
            outcomes = await Promise.allSettled([withdrawalOperation, refundOperation]);
          } finally {
            barrier.release.resolve();
            await Promise.allSettled([withdrawalOperation, refundOperation]);
          }
          expect(outcomes[1].status).toBe('fulfilled');
          if (order === 'REFUND_FIRST') {
            expect(outcomes[0].status).toBe('rejected');
            if (outcomes[0].status === 'rejected') {
              expect(outcomes[0].reason).toMatchObject({ code: 'WITHDRAWAL_BALANCE_INSUFFICIENT' });
            }
          } else {
            expect(outcomes[0]).toMatchObject({
              status: 'fulfilled',
              value: expect.objectContaining({ status: 'PENDING', withdrawalId: ids.withdrawalIds[0] }),
            });
          }

          const expectedAvailable = order === 'REFUND_FIRST' ? new Prisma.Decimal(0) : seeded.minimum.negated();
          const expectedFrozen = order === 'REFUND_FIRST' ? new Prisma.Decimal(0) : seeded.minimum;
          const wallet = await runtime.prisma.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } });
          expect(wallet).toMatchObject({
            available_balance: expectedAvailable,
            frozen_balance: expectedFrozen,
            version: order === 'REFUND_FIRST' ? 2 : 3,
          });
          const totals = await runtime.prisma.commissionLedger.aggregate({
            _sum: { available_change: true, expected_change: true, frozen_change: true },
            where: { agent_id: ids.agentId },
          });
          expect(totals._sum).toEqual({
            available_change: expectedAvailable,
            expected_change: seeded.minimum,
            frozen_change: expectedFrozen,
          });
          await expect(runtime.prisma.orderItemCommissionPosition.findUniqueOrThrow({
            where: { id: ids.commissionPositionId },
          })).resolves.toMatchObject({
            expected_remaining: new Prisma.Decimal(0),
            reversed_total: seeded.minimum,
            state: 'AVAILABLE',
            version: 2,
          });
          await expect(runtime.prisma.refund.findUniqueOrThrow({ where: { id: ids.refundId } }))
            .resolves.toMatchObject({ status: 'SUCCEEDED' });
          await expect(runtime.prisma.refundItem.findUniqueOrThrow({ where: { id: ids.refundItemId } }))
            .resolves.toMatchObject({ commission_reversal: seeded.minimum });
          await runtime.withPrismaTransaction(
            (transaction) => validateAgentCommissionLedgerClosureInTransaction(transaction, ids.agentId),
            { isolationLevel: 'RepeatableRead' },
          );
        } finally {
          await cleanupFullFixture(cleanupConnectionString, ids);
          await assertFixtureAbsent(runtime, ids);
        }
      }
    }, 240_000);
});
