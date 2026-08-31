import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import { generateUlid } from '@qingxu/platform-core';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FulfillmentCompletionService } from '../../../apps/api/src/fulfillment/fulfillment-completion.service';
import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { FulfillmentRepository } from './fulfillment.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B11_FULFILLMENT_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B11_FULFILLMENT_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B11_COMPLETION_ROLLBACK_SENTINEL' });
const transactionOptions = { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function serviceConfig(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: {
        current: { id: 'b113-idempotency-v1', key: Buffer.alloc(32, 113) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 114),
    },
    environment: 'test',
  } as unknown as PlatformRuntimeConfig;
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B11 completion database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B11 completion tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    const username = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
      throw new TypeError('Full B11 completion tests require a loopback mall_runtime test database');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b113-completion-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b113-completion-rollback',
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
  const directUsername = decodeURIComponent(directUrl.username);
  const runtimeUsername = decodeURIComponent(runtimeUrl.username);
  const database = decodeURIComponent(directUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !['postgres:', 'postgresql:'].includes(runtimeUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || !LOOPBACK_HOSTS.has(runtimeUrl.hostname) ||
    directUsername !== 'mall_migrator' || runtimeUsername !== 'mall_runtime' ||
    !directUrl.password || !runtimeUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    runtimeUrl.search !== '' || runtimeUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B11 completion cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
  duplicateAuditId?: string,
): DatabaseRuntime {
  const commandTransaction = duplicateAuditId === undefined
    ? transaction
    : new Proxy(transaction, {
        get(target, property, receiver) {
          if (property !== 'auditLog') return Reflect.get(target, property, receiver);
          const delegate = target.auditLog;
          return new Proxy(delegate, {
            get(delegateTarget, delegateProperty, delegateReceiver) {
              if (delegateProperty !== 'create') {
                return Reflect.get(delegateTarget, delegateProperty, delegateReceiver);
              }
              return (input: Parameters<DatabaseTransaction['auditLog']['create']>[0]) =>
                delegate.create({ ...input, data: { ...input.data, id: duplicateAuditId } });
            },
          });
        },
      });
  let savepoint = 0;
  const prisma = new Proxy(commandTransaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => {
          savepoint += 1;
          const name = `b113_nested_${savepoint}`;
          await transaction.$executeRawUnsafe(`SAVEPOINT "${name}"`);
          try {
            const value = await work(commandTransaction);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
            return value;
          } catch (error) {
            await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

interface CompletionFixture {
  accountIds: [string, string, string];
  agentId: string;
  brandId: string;
  businessRuleId: string;
  categoryId: string;
  commissionRuleId: string;
  customerId: string;
  itemId: string;
  orderId: string;
  paymentAttemptId: string;
  paymentIntentId: string;
  positionId: string;
  productId: string;
  shipmentId: string;
  shipmentItemId: string;
  skuId: string;
  snapshotId: string;
  walletId: string;
}

function fixture(now: Date): CompletionFixture {
  let offset = 1;
  const next = () => generateUlid(now.getTime() + offset++);
  return {
    accountIds: [next(), next(), next()],
    agentId: next(),
    brandId: next(),
    businessRuleId: next(),
    categoryId: next(),
    commissionRuleId: next(),
    customerId: next(),
    itemId: next(),
    orderId: next(),
    paymentAttemptId: next(),
    paymentIntentId: next(),
    positionId: next(),
    productId: next(),
    shipmentId: next(),
    shipmentItemId: next(),
    skuId: next(),
    snapshotId: next(),
    walletId: next(),
  };
}

async function seedCompletionFixture(
  transaction: DatabaseTransaction,
  ids: CompletionFixture,
  now: Date,
  options: {
    commissionMode?: 'DIRECT' | 'POSITIVE' | 'ZERO';
    shipmentStatus?: 'DELIVERED' | 'IN_TRANSIT' | 'SHIPPED';
    withWallet?: boolean;
  } = {},
): Promise<{ businessRuleId: string; previousPublishedRuleIds: string[]; windowDays: number }> {
  const [adminId, customerAccountId, agentAccountId] = ids.accountIds;
  const commissionMode = options.commissionMode ?? 'POSITIVE';
  const shipmentStatus = options.shipmentStatus ?? 'IN_TRANSIT';
  await transaction.account.createMany({
    data: [{
      created_at: now,
      id: adminId,
      login_name: `b113-admin-${adminId}`,
      password_hash: 'b113-admin-password-hash',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    }, {
      created_at: now,
      id: customerAccountId,
      login_name: null,
      password_hash: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
      wechat_open_id: `b113-open-${customerAccountId}`,
    }, {
      created_at: now,
      id: agentAccountId,
      login_name: `b113-agent-${agentAccountId}`,
      password_hash: 'b113-agent-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    }],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: customerAccountId,
      created_at: now,
      id: ids.customerId,
      nickname: 'B11.3 Completion Customer',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: agentAccountId,
      agent_no: `B113-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B11.3 Completion Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  if (options.withWallet !== false && commissionMode === 'POSITIVE') {
    await transaction.agentWallet.create({
      data: {
        agent_id: ids.agentId,
        available_balance: '1.00',
        frozen_balance: '0.00',
        id: ids.walletId,
        updated_at: now,
        version: 1,
      },
    });
  }
  await transaction.brand.create({
    data: {
      created_at: now, id: ids.brandId, name: `B113 Brand ${ids.brandId}`, sort_order: 0,
      status: 'ACTIVE', updated_at: now, version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now, id: ids.categoryId, name: `B113 Category ${ids.categoryId}`, sort_order: 0,
      status: 'ACTIVE', updated_at: now, version: 1,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: ids.brandId,
      category_id: ids.categoryId,
      created_at: now,
      id: ids.productId,
      name: 'B11.3 Completion Product',
      published_at: now,
      sales_count: 1,
      spu_code: `B113-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B113-SKU-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B11.3 Completion SKU',
      product_id: ids.productId,
      retail_price: '50.00',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: ids.customerId,
      final_agent_id: commissionMode === 'DIRECT' ? null : ids.agentId,
      final_channel: commissionMode === 'DIRECT' ? 'DIRECT' : 'AGENT',
      fulfillment_status: shipmentStatus,
      goods_amount: '50.00',
      id: ids.orderId,
      order_no: `QX${ids.orderId}`,
      order_status: 'SHIPPING',
      paid_amount: '50.00',
      paid_at: now,
      pay_expires_at: new Date(now.getTime() + 30 * 60_000),
      payable_amount: '50.00',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'PARTIAL',
      refunded_amount: '5.00',
      shipping_amount: '0.00',
      source: 'BUY_NOW',
      updated_at: now,
      version: 4,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: '0.00',
      aftersale_reserved_qty: 0,
      brand_name_snapshot: 'B11.3 Completion Brand',
      category_id: ids.categoryId,
      category_name_snapshot: 'B11.3 Completion Category',
      created_at: now,
      id: ids.itemId,
      line_paid_amount: '50.00',
      order_id: ids.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: ids.productId,
      product_name_snapshot: 'B11.3 Completion Product',
      quantity: 1,
      refunded_amount: '5.00',
      refunded_qty: 0,
      shipped_qty: 1,
      sku_code_snapshot: `B113-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B11.3 Completion SKU',
      unit_price: '50.00',
      version: 2,
    },
  });
  await transaction.shipment.create({
    data: {
      carrier_code: 'B113',
      carrier_name: 'B11.3 Carrier',
      created_at: now,
      delivered_at: shipmentStatus === 'DELIVERED' ? now : null,
      id: ids.shipmentId,
      items: { create: { created_at: now, id: ids.shipmentItemId, order_item_id: ids.itemId, quantity: 1 } },
      order_id: ids.orderId,
      shipped_at: now,
      status: shipmentStatus,
      tracking_no: `B113-${ids.shipmentId}`,
      updated_at: now,
      version: 2,
    },
  });
  await transaction.paymentIntent.create({
    data: {
      amount: '50.00',
      closed_at: null,
      create_requested_at: now,
      created_at: now,
      expires_at: new Date(now.getTime() + 30 * 60_000),
      id: ids.paymentIntentId,
      intent_no: `PI${ids.paymentIntentId}`,
      order_id: ids.orderId,
      provider: 'MOCK',
      provider_intent_id: `b113-provider-${ids.paymentIntentId}`,
      status: 'SUCCEEDED',
      succeeded_at: now,
      updated_at: now,
      version: 2,
    },
  });
  await transaction.paymentAttempt.create({
    data: {
      amount: '50.00',
      finished_at: now,
      id: ids.paymentAttemptId,
      initiated_at: now,
      payment_intent_id: ids.paymentIntentId,
      provider: 'MOCK',
      provider_transaction_id: `b113-transaction-${ids.paymentAttemptId}`,
      status: 'SUCCEEDED',
    },
  });
  if (commissionMode !== 'DIRECT') {
    const commissionVersion = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
    await transaction.commissionRuleVersion.create({
      data: {
        created_at: now,
        created_by_id: agentAccountId,
        effective_at: now,
        id: ids.commissionRuleId,
        reason: 'B11.3 frozen commission fixture',
        status: 'DRAFT',
        version_no: (commissionVersion._max.version_no ?? 0) + 1,
      },
    });
    await transaction.orderItemCommissionSnapshot.create({
      data: {
        agent_id: ids.agentId,
        category_id_snapshot: ids.categoryId,
        category_name_snapshot: 'B11.3 Completion Category',
        commission_base: '50.00',
        created_at: now,
        effective_rate: commissionMode === 'ZERO' ? '0.0000' : '10.0000',
        id: ids.snapshotId,
        order_item_id: ids.itemId,
        original_commission: commissionMode === 'ZERO' ? '0.00' : '5.00',
        product_id_snapshot: ids.productId,
        rule_version_id: ids.commissionRuleId,
        sku_id_snapshot: ids.skuId,
        source_type: 'PLATFORM',
      },
    });
    await transaction.orderItemCommissionPosition.create({
      data: {
        available_at: null,
        expected_remaining: commissionMode === 'ZERO' ? '0.00' : '4.50',
        id: ids.positionId,
        original_commission: commissionMode === 'ZERO' ? '0.00' : '5.00',
        reversed_total: commissionMode === 'ZERO' ? '0.00' : '0.50',
        snapshot_id: ids.snapshotId,
        state: commissionMode === 'ZERO' ? 'NONE' : 'EXPECTED',
        updated_at: now,
        version: 2,
      },
    });
  }

  const publishedRules = await transaction.businessRuleVersion.findMany({
    select: { id: true },
    where: { status: 'PUBLISHED' },
  });
  for (const published of publishedRules) {
    await transaction.businessRuleVersion.update({ data: { status: 'ARCHIVED' }, where: { id: published.id } });
  }
  const ruleVersion = await transaction.businessRuleVersion.aggregate({ _max: { version_no: true } });
  const businessRuleId = ids.businessRuleId;
  const windowDays = 5;
  await transaction.businessRuleVersion.create({
    data: {
      aftersale_window_days: windowDays,
      created_at: now,
      created_by_id: adminId,
      effective_at: new Date(now.getTime() - 60_000),
      id: businessRuleId,
      legal_record_retention_years: 10,
      minimum_withdrawal_amount: '100.00',
      order_payment_timeout_minutes: 30,
      reason: 'B11.3 completion integration rule',
      status: 'PUBLISHED',
      version_no: (ruleVersion._max.version_no ?? 0) + 1,
    },
  });
  return { businessRuleId, previousPublishedRuleIds: publishedRules.map(({ id }) => id), windowDays };
}

async function assertNoFixtureFacts(
  runtime: DatabaseRuntime,
  ids: CompletionFixture,
  relatedOutboxAggregateIds: readonly string[] = [],
  restoredPublishedRuleIds: readonly string[] = [],
): Promise<void> {
  const checks = [
    ['shipment_item', runtime.prisma.shipmentItem.count({ where: { shipment: { order_id: ids.orderId } } })],
    ['logistics_event', runtime.prisma.logisticsEvent.count({ where: { shipment: { order_id: ids.orderId } } })],
    ['shipment', runtime.prisma.shipment.count({ where: { order_id: ids.orderId } })],
    ['order_item', runtime.prisma.orderItem.count({ where: { order_id: ids.orderId } })],
    ['payment_attempt', runtime.prisma.paymentAttempt.count({
      where: { payment_intent: { order_id: ids.orderId } },
    })],
    ['payment_intent', runtime.prisma.paymentIntent.count({ where: { order_id: ids.orderId } })],
    ['refund_attempt', runtime.prisma.refundAttempt.count({ where: { refund: { order_id: ids.orderId } } })],
    ['refund_item', runtime.prisma.refundItem.count({ where: { refund: { order_id: ids.orderId } } })],
    ['refund', runtime.prisma.refund.count({ where: { order_id: ids.orderId } })],
    ['aftersale_item', runtime.prisma.aftersaleItem.count({ where: { aftersale: { order_id: ids.orderId } } })],
    ['aftersale', runtime.prisma.aftersale.count({ where: { order_id: ids.orderId } })],
    ['commission_position', runtime.prisma.orderItemCommissionPosition.count({
      where: { snapshot: { order_item: { order_id: ids.orderId } } },
    })],
    ['commission_snapshot', runtime.prisma.orderItemCommissionSnapshot.count({
      where: { order_item: { order_id: ids.orderId } },
    })],
    ['commission_rule_entry', runtime.prisma.commissionRuleEntry.count({
      where: { rule_version_id: ids.commissionRuleId },
    })],
    ['commission_rule', runtime.prisma.commissionRuleVersion.count({ where: { id: ids.commissionRuleId } })],
    ['commission_ledger', runtime.prisma.commissionLedger.count({ where: { agent_id: ids.agentId } })],
    ['agent_wallet', runtime.prisma.agentWallet.count({ where: { agent_id: ids.agentId } })],
    ['sales_order', runtime.prisma.salesOrder.count({ where: { id: ids.orderId } })],
    ['business_rule', runtime.prisma.businessRuleVersion.count({ where: { id: ids.businessRuleId } })],
    ['agent_profile', runtime.prisma.agentProfile.count({ where: { id: ids.agentId } })],
    ['customer_profile', runtime.prisma.customerProfile.count({ where: { id: ids.customerId } })],
    ['sku', runtime.prisma.sku.count({ where: { id: ids.skuId } })],
    ['product', runtime.prisma.product.count({ where: { id: ids.productId } })],
    ['category', runtime.prisma.category.count({ where: { id: ids.categoryId } })],
    ['brand', runtime.prisma.brand.count({ where: { id: ids.brandId } })],
    ['idempotency_record', runtime.prisma.idempotencyRecord.count({
      where: { OR: [{ actor_id: { in: ids.accountIds } }, { resource_id: ids.orderId }] },
    })],
    ['audit_log', runtime.prisma.auditLog.count({
      where: { OR: [{ actor_account_id: { in: ids.accountIds } }, { object_id: ids.orderId }] },
    })],
    ['outbox_event', runtime.prisma.outboxEvent.count({
      where: { aggregate_id: { in: [ids.orderId, ...relatedOutboxAggregateIds] } },
    })],
    ['account', runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } })],
  ] as const;
  const counts = Object.fromEntries(await Promise.all(checks.map(async ([table, query]) => [table, await query])));
  expect(counts).toEqual(Object.fromEntries(checks.map(([table]) => [table, 0])));

  const restoredPublishedRuleCount = await runtime.prisma.businessRuleVersion.count({
    where: { id: { in: restoredPublishedRuleIds }, status: 'PUBLISHED' },
  });
  expect(restoredPublishedRuleCount).toBe(restoredPublishedRuleIds.length);
}

async function cleanupFullFixture(
  connectionString: string,
  ids: CompletionFixture,
  previousPublishedRuleIds: readonly string[],
): Promise<string[]> {
  const pool = new Pool({
    application_name: 'qingxu-b113-completion-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client: PoolClient | undefined;
  let relatedOutboxAggregateIds: string[] = [];
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const ledgerIds = await client.query<{ id: string }>(
      'SELECT id FROM public.commission_ledger WHERE agent_id = $1 ORDER BY id',
      [ids.agentId],
    );
    relatedOutboxAggregateIds = ledgerIds.rows.map(({ id }) => id);
    await client.query(
      `DELETE FROM public.outbox_event
       WHERE aggregate_id = $1
          OR aggregate_id IN (SELECT id FROM public.commission_ledger WHERE agent_id = $2)`,
      [ids.orderId, ids.agentId],
    );
    await client.query('DELETE FROM public.audit_log WHERE actor_account_id::text = ANY($1::text[])', [
      [...ids.accountIds],
    ]);
    await client.query('DELETE FROM public.idempotency_record WHERE actor_id::text = ANY($1::text[])', [
      [...ids.accountIds],
    ]);
    await client.query('DELETE FROM public.commission_ledger WHERE agent_id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.order_item_commission_position WHERE snapshot_id = $1', [ids.snapshotId]);
    await client.query('DELETE FROM public.order_item_commission_snapshot WHERE id = $1', [ids.snapshotId]);
    await client.query(
      'DELETE FROM public.refund_attempt WHERE refund_id IN (SELECT id FROM public.refund WHERE order_id = $1)',
      [ids.orderId],
    );
    await client.query(
      'DELETE FROM public.refund_item WHERE refund_id IN (SELECT id FROM public.refund WHERE order_id = $1)',
      [ids.orderId],
    );
    await client.query('DELETE FROM public.refund WHERE order_id = $1', [ids.orderId]);
    await client.query(
      'DELETE FROM public.aftersale_item WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id = $1)',
      [ids.orderId],
    );
    await client.query('DELETE FROM public.aftersale WHERE order_id = $1', [ids.orderId]);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id IN (SELECT id FROM public.payment_intent WHERE order_id = $1)',
      [ids.orderId],
    );
    await client.query('DELETE FROM public.payment_intent WHERE order_id = $1', [ids.orderId]);
    await client.query('DELETE FROM public.logistics_event WHERE shipment_id = $1', [ids.shipmentId]);
    await client.query('DELETE FROM public.shipment_item WHERE shipment_id = $1', [ids.shipmentId]);
    await client.query('DELETE FROM public.shipment WHERE id = $1', [ids.shipmentId]);
    await client.query('DELETE FROM public.order_item WHERE order_id = $1', [ids.orderId]);
    await client.query('DELETE FROM public.sales_order WHERE id = $1', [ids.orderId]);
    await client.query('DELETE FROM public.agent_wallet WHERE agent_id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.commission_rule_version WHERE id = $1', [ids.commissionRuleId]);
    await client.query('DELETE FROM public.agent_profile WHERE id = $1', [ids.agentId]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [ids.skuId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [ids.productId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [ids.categoryId]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [ids.brandId]);
    await client.query('DELETE FROM public.customer_profile WHERE id = $1', [ids.customerId]);
    await client.query('DELETE FROM public.business_rule_version WHERE id = $1', [ids.businessRuleId]);
    if (previousPublishedRuleIds.length > 0) {
      await client.query(
        `UPDATE public.business_rule_version
         SET status = 'PUBLISHED'
         WHERE id::text = ANY($1::text[])`,
        [[...previousPublishedRuleIds]],
      );
    }
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [[...ids.accountIds]]);
    await client.query('COMMIT');
  } catch (error) {
    if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
  return relatedOutboxAggregateIds;
}

databaseDescribe('B11.3 fulfillment completion database integration', () => {
  let runtime: DatabaseRuntime;
  let cleanupConnectionString: string | undefined;

  beforeAll(async () => {
    if (mode === 'full') cleanupConnectionString = fullCleanupConnectionString();
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    if (runtime !== undefined) await runtime.disconnect();
  }, 30_000);

  it('completes with mall_runtime, seals delivery, credits only the remainder and rolls every fact back', async () => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const repository = new FulfillmentRepository(runtime.prisma, undefined, () => new Date(0));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      const { businessRuleId, windowDays } = await seedCompletionFixture(transaction, ids, now);
      const result = await repository.completeOrderInTransaction(transaction, {
        actor: { accountId: ids.accountIds[1], customerId: ids.customerId, kind: 'CUSTOMER' },
        completionReason: 'CUSTOMER_CONFIRMED',
        expectedOrderVersion: 4,
        orderId: ids.orderId,
      });
      expect(result).toMatchObject({
        after: { fulfillmentStatus: 'DELIVERED', orderStatus: 'COMPLETED', orderVersion: 5, shipmentVersion: 3 },
        before: { fulfillmentStatus: 'IN_TRANSIT', orderStatus: 'SHIPPING', orderVersion: 4, shipmentVersion: 2 },
        businessRuleVersionId: businessRuleId,
        commissionCredits: [{ version: 3 }],
      });
      expect(result.completedAt.getTime()).toBeGreaterThan(now.getTime());
      expect(result.aftersaleExpiresAt.getTime() - result.completedAt.getTime())
        .toBe(windowDays * 86_400_000);
      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } })).resolves.toMatchObject({
        business_rule_version_id: businessRuleId,
        completion_reason: 'CUSTOMER_CONFIRMED',
        fulfillment_status: 'DELIVERED',
        order_status: 'COMPLETED',
        version: 5,
      });
      await expect(transaction.shipment.findUniqueOrThrow({ where: { id: ids.shipmentId } })).resolves.toMatchObject({
        status: 'DELIVERED', version: 3,
      });
      await expect(transaction.logisticsEvent.count({ where: { shipment_id: ids.shipmentId } })).resolves.toBe(0);
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({
        where: { id: ids.positionId },
      })).resolves.toMatchObject({
        expected_remaining: new Prisma.Decimal('0.00'), state: 'AVAILABLE', version: 3,
      });
      await expect(transaction.commissionLedger.findMany({
        where: { agent_id: ids.agentId, ledger_type: 'AVAILABLE_CREDIT', snapshot_id: ids.snapshotId },
      })).resolves.toEqual([expect.objectContaining({
        available_change: new Prisma.Decimal('4.50'),
        expected_change: new Prisma.Decimal('-4.50'),
        reason: 'ORDER_COMPLETED',
      })]);
      await expect(transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } })).resolves.toMatchObject({
        available_balance: new Prisma.Decimal('5.50'), version: 2,
      });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it('keeps service completion, HASH_ONLY replay, audit and Outbox exact-once in one real transaction', async () => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const idempotencyKey = randomUUID();

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now);
      const service = new FulfillmentCompletionService(
        serviceConfig(),
        transactionBoundRuntime(runtime, transaction),
      );
      const command = {
        accountId: ids.accountIds[1],
        customerId: ids.customerId,
        expectedOrderVersion: 4,
        idempotencyKey,
        ipAddress: '127.0.0.1',
        orderId: ids.orderId,
        requestId: requestId(),
      };
      const first = await service.confirmCustomer(command);
      if (!('after' in first)) throw new TypeError('First completion unexpectedly replayed');
      expect(first).toMatchObject({
        after: { orderStatus: 'COMPLETED', orderVersion: 5 },
        commissionCredits: [{ version: 3 }],
        orderId: ids.orderId,
      });
      const creditId = first.commissionCredits[0]?.ledgerId;
      if (creditId === undefined) throw new TypeError('Positive completion credit was not returned');

      const replay = await service.confirmCustomer({ ...command, requestId: requestId() });
      expect(replay).toMatchObject({
        completionReason: 'CUSTOMER_CONFIRMED',
        orderId: ids.orderId,
        orderVersion: 5,
        shipmentStatus: 'DELIVERED',
      });
      expect('after' in replay).toBe(false);

      await expect(transaction.idempotencyRecord.findMany({
        where: { actor_id: ids.accountIds[1], idempotency_key: idempotencyKey },
      })).resolves.toEqual([expect.objectContaining({
        resource_id: ids.orderId,
        response_body: null,
        response_body_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        response_status: 200,
      })]);
      await expect(transaction.auditLog.findMany({
        where: { actor_account_id: ids.accountIds[1], object_id: ids.orderId },
      })).resolves.toEqual([expect.objectContaining({
        action: 'CONFIRM',
        actor_role: 'CUSTOMER',
        idempotency_key: idempotencyKey,
        module: 'fulfillment',
        object_type: 'order',
      })]);
      const events = await transaction.outboxEvent.findMany({
        orderBy: [{ event_type: 'asc' }, { aggregate_id: 'asc' }],
        where: { aggregate_id: { in: [ids.orderId, creditId] } },
      });
      expect(events.map(({ aggregate_id, event_type }) => [aggregate_id, event_type])).toEqual([
        [creditId, 'commission.available.credited'],
        [ids.orderId, 'order.completed'],
      ]);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it('rolls business and metadata facts back when the service hits a real audit primary-key constraint', async () => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const idempotencyKey = randomUUID();
    const duplicateAuditId = generateUlid();

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now);
      await transaction.auditLog.create({
        data: {
          action: 'LOGIN',
          actor_account_id: ids.accountIds[0],
          actor_role: 'SUPER_ADMIN',
          id: duplicateAuditId,
          module: 'security',
          object_id: ids.accountIds[0],
          object_type: 'account',
          occurred_at: now,
          request_id: requestId(),
          result: 'SUCCESS',
          result_code: 'OK',
        },
      });
      const service = new FulfillmentCompletionService(
        serviceConfig(),
        transactionBoundRuntime(runtime, transaction, duplicateAuditId),
      );
      await expect(service.completeAdmin({
        actorAccountId: ids.accountIds[0],
        expectedOrderVersion: 4,
        idempotencyKey,
        orderId: ids.orderId,
        reason: 'Verified delivery evidence',
        requestId: requestId(),
      })).rejects.toBeDefined();

      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
        .resolves.toMatchObject({ fulfillment_status: 'IN_TRANSIT', order_status: 'SHIPPING', version: 4 });
      await expect(transaction.shipment.findUniqueOrThrow({ where: { id: ids.shipmentId } }))
        .resolves.toMatchObject({ status: 'IN_TRANSIT', version: 2 });
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.positionId } }))
        .resolves.toMatchObject({ expected_remaining: new Prisma.Decimal('4.50'), state: 'EXPECTED', version: 2 });
      await expect(transaction.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } }))
        .resolves.toMatchObject({ available_balance: new Prisma.Decimal('1.00'), version: 1 });
      await expect(Promise.all([
        transaction.commissionLedger.count({ where: { agent_id: ids.agentId } }),
        transaction.idempotencyRecord.count({ where: { idempotency_key: idempotencyKey } }),
        transaction.auditLog.count({ where: { object_id: ids.orderId } }),
        transaction.outboxEvent.count({ where: { aggregate_id: ids.orderId } }),
      ])).resolves.toEqual([0, 0, 0, 0]);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it.each([
    ['SHIPPED', 3],
    ['DELIVERED', 2],
  ] as const)('seals %s without inventing a logistics event and rolls back cleanly', async (status, expectedVersion) => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const repository = new FulfillmentRepository(runtime.prisma);
    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now, { shipmentStatus: status });
      const result = await repository.completeOrderInTransaction(transaction, {
        actor: { actorAccountId: ids.accountIds[0], kind: 'ADMIN' },
        completionReason: 'ADMIN_FORCED',
        expectedOrderVersion: 4,
        orderId: ids.orderId,
      });
      expect(result).toMatchObject({
        after: { shipmentStatus: 'DELIVERED', shipmentVersion: expectedVersion },
        before: { shipmentStatus: status, shipmentVersion: 2 },
      });
      await expect(transaction.logisticsEvent.count({ where: { shipment_id: ids.shipmentId } })).resolves.toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it.each(['DIRECT', 'ZERO'] as const)('completes %s attribution without a wallet or zero ledger', async (mode) => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const repository = new FulfillmentRepository(runtime.prisma);
    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now, { commissionMode: mode, withWallet: false });
      const result = await repository.completeOrderInTransaction(transaction, {
        actor: { accountId: ids.accountIds[1], customerId: ids.customerId, kind: 'CUSTOMER' },
        completionReason: 'CUSTOMER_CONFIRMED',
        expectedOrderVersion: 4,
        orderId: ids.orderId,
      });
      expect(result.commissionCredits).toEqual([]);
      await expect(transaction.commissionLedger.count({ where: { agent_id: ids.agentId } })).resolves.toBe(0);
      await expect(transaction.agentWallet.count({ where: { agent_id: ids.agentId } })).resolves.toBe(0);
      if (mode === 'ZERO') {
        await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({
          where: { id: ids.positionId },
        })).resolves.toMatchObject({ state: 'NONE', version: 2 });
      }
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it('fails closed before mutation when a positive commission wallet is missing', async () => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const repository = new FulfillmentRepository(runtime.prisma);
    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now, { withWallet: false });
      await expect(repository.completeOrderInTransaction(transaction, {
        actor: { actorAccountId: ids.accountIds[0], kind: 'ADMIN' },
        completionReason: 'ADMIN_FORCED',
        expectedOrderVersion: 4,
        orderId: ids.orderId,
      })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
        .resolves.toMatchObject({ fulfillment_status: 'IN_TRANSIT', order_status: 'SHIPPING', version: 4 });
      await expect(transaction.shipment.findUniqueOrThrow({ where: { id: ids.shipmentId } }))
        .resolves.toMatchObject({ status: 'IN_TRANSIT', version: 2 });
      await expect(transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.positionId } }))
        .resolves.toMatchObject({ expected_remaining: new Prisma.Decimal('4.50'), state: 'EXPECTED', version: 2 });
      await expect(transaction.commissionLedger.count({ where: { agent_id: ids.agentId } })).resolves.toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  it('blocks active payment, refund and aftersale facts before allowing terminal facts', async () => {
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const repository = new FulfillmentRepository(runtime.prisma);
    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedCompletionFixture(transaction, ids, now, { commissionMode: 'DIRECT', withWallet: false });
      const activeIntentId = generateUlid();
      await transaction.paymentIntent.create({
        data: {
          amount: '50.00',
          create_requested_at: now,
          created_at: now,
          expires_at: new Date(now.getTime() + 30 * 60_000),
          id: activeIntentId,
          intent_no: `PI${activeIntentId}`,
          opened_at: now,
          order_id: ids.orderId,
          provider: 'MOCK',
          provider_intent_id: `b113-active-${activeIntentId}`,
          status: 'OPEN',
          updated_at: now,
          version: 1,
        },
      });
      const input = {
        actor: { actorAccountId: ids.accountIds[0], kind: 'ADMIN' as const },
        completionReason: 'ADMIN_FORCED' as const,
        expectedOrderVersion: 4,
        orderId: ids.orderId,
      };
      await expect(repository.completeOrderInTransaction(transaction, input))
        .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
      await transaction.paymentIntent.update({ data: { status: 'FAILED', version: { increment: 1 } }, where: {
        id: activeIntentId,
      } });

      const aftersaleId = generateUlid();
      await transaction.aftersale.create({
        data: {
          aftersale_no: `AS${aftersaleId}`,
          created_at: now,
          customer_id: ids.customerId,
          id: aftersaleId,
          order_id: ids.orderId,
          reason_code: 'B113_ACTIVE_RISK',
          status: 'PENDING_REVIEW',
          type: 'REFUND_ONLY',
          updated_at: now,
          version: 1,
        },
      });
      const refundId = generateUlid();
      await transaction.refund.create({
        data: {
          aftersale_id: aftersaleId,
          amount: '1.00',
          id: refundId,
          is_late_payment_refund: false,
          order_id: ids.orderId,
          origin_type: 'AFTERSALE',
          provider: 'MOCK',
          reason: 'B11.3 active refund fixture',
          refund_no: `RF${refundId}`,
          requested_at: now,
          status: 'PENDING',
          updated_at: now,
          version: 1,
        },
      });
      await expect(repository.completeOrderInTransaction(transaction, input))
        .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
      await transaction.refund.update({ data: { status: 'CANCELLED', version: { increment: 1 } }, where: {
        id: refundId,
      } });
      await expect(repository.completeOrderInTransaction(transaction, input))
        .rejects.toMatchObject({ code: 'ORDER_NOT_RECEIVABLE' });
      await transaction.aftersale.update({
        data: { cancelled_at: now, status: 'CANCELLED', version: { increment: 1 } },
        where: { id: aftersaleId },
      });
      await expect(repository.completeOrderInTransaction(transaction, input))
        .resolves.toMatchObject({ after: { orderStatus: 'COMPLETED' }, commissionCredits: [] });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, ids);
  }, 120_000);

  fullIt('converges CUSTOMER and ADMIN service commands to one completion and one metadata set', async () => {
    if (cleanupConnectionString === undefined) throw new TypeError('B11 completion cleanup was not initialized');
    const now = new Date(Date.now() - 5 * 60_000);
    const ids = fixture(now);
    const service = new FulfillmentCompletionService(serviceConfig(), runtime);
    const customerKey = randomUUID();
    const adminKey = randomUUID();
    let previousPublishedRuleIds: string[] = [];
    let relatedOutboxAggregateIds: string[] = [];
    try {
      await runtime.prisma.$transaction(async (transaction) => {
        const seeded = await seedCompletionFixture(transaction, ids, now, { shipmentStatus: 'SHIPPED' });
        previousPublishedRuleIds = seeded.previousPublishedRuleIds;
      }, transactionOptions);

      const outcomes = await Promise.allSettled([
        service.confirmCustomer({
          accountId: ids.accountIds[1],
          customerId: ids.customerId,
          expectedOrderVersion: 4,
          idempotencyKey: customerKey,
          orderId: ids.orderId,
          requestId: requestId(),
        }),
        service.completeAdmin({
          actorAccountId: ids.accountIds[0],
          expectedOrderVersion: 4,
          idempotencyKey: adminKey,
          orderId: ids.orderId,
          reason: 'Concurrent delivery verification',
          requestId: requestId(),
        }),
      ]);
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find(({ status }) => status === 'rejected');
      expect(rejected).toMatchObject({ reason: { code: 'ORDER_NOT_RECEIVABLE' }, status: 'rejected' });
      await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
        .resolves.toMatchObject({ fulfillment_status: 'DELIVERED', order_status: 'COMPLETED', version: 5 });
      const completed = await runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } });
      expect(['ADMIN_FORCED', 'CUSTOMER_CONFIRMED']).toContain(completed.completion_reason);
      await expect(runtime.prisma.commissionLedger.count({
        where: { agent_id: ids.agentId, ledger_type: 'AVAILABLE_CREDIT', snapshot_id: ids.snapshotId },
      })).resolves.toBe(1);
      await expect(runtime.prisma.idempotencyRecord.count({
        where: { actor_id: { in: [ids.accountIds[0], ids.accountIds[1]] }, idempotency_key: {
          in: [adminKey, customerKey],
        } },
      })).resolves.toBe(1);
      await expect(runtime.prisma.auditLog.count({
        where: { actor_account_id: { in: [ids.accountIds[0], ids.accountIds[1]] }, object_id: ids.orderId },
      })).resolves.toBe(1);
      await expect(runtime.prisma.outboxEvent.count({
        where: { aggregate_id: ids.orderId, event_type: 'order.completed' },
      })).resolves.toBe(1);
      const ledger = await runtime.prisma.commissionLedger.findFirstOrThrow({
        where: { agent_id: ids.agentId, ledger_type: 'AVAILABLE_CREDIT', snapshot_id: ids.snapshotId },
      });
      await expect(runtime.prisma.outboxEvent.count({
        where: { aggregate_id: ledger.id, event_type: 'commission.available.credited' },
      })).resolves.toBe(1);
      await expect(runtime.prisma.agentWallet.findUniqueOrThrow({ where: { id: ids.walletId } }))
        .resolves.toMatchObject({ available_balance: new Prisma.Decimal('5.50'), version: 2 });
      await expect(runtime.prisma.logisticsEvent.count({ where: { shipment_id: ids.shipmentId } })).resolves.toBe(0);
    } finally {
      relatedOutboxAggregateIds = await cleanupFullFixture(cleanupConnectionString, ids, previousPublishedRuleIds);
    }
    await assertNoFixtureFacts(runtime, ids, relatedOutboxAggregateIds, previousPublishedRuleIds);
  }, 120_000);
});
