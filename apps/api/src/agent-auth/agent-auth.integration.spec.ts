import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAgentRepository,
  AgentAuthRepository,
  createDatabaseRuntime,
  runSerializableTransaction,
  StorePaymentRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import {
  generateUlid,
  hashPassword,
  hmacAuthenticationIdentity,
} from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdminAgentsService } from '../admin-agents/admin-agents.service';
import type { AdminAgentRequestContext } from '../admin-agents/admin-agents.request';
import { ApiRuntimeModule } from '../api-runtime.module';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { AgentAuthController } from './agent-auth.controller';
import { AgentLoginRateLimiter } from './agent-login-rate-limiter';
import { AgentAuthService } from './agent-auth.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B13_AGENT_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B13_AGENT_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const rollbackSentinel = Object.freeze({ code: 'B13_AGENT_AUTH_ROLLBACK_SENTINEL' });
const prismaTransactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 120_000,
};
const transactionRetryOptions = { initialDelayMs: 10, maxAttempts: 5 };

interface PaymentFixture {
  accountId: string;
  addressId: string;
  attributionId: string;
  balanceId: string;
  bindingId: string;
  brandId: string;
  categoryId: string;
  commissionEntryId: string;
  commissionVersionId: string;
  customerId: string;
  inventoryLedgerId: string;
  orderId: string;
  orderItemId: string;
  paymentIntentId: string;
  productId: string;
  providerIntentId: string;
  reservationId: string;
  reservationItemId: string;
  skuId: string;
}

interface FullCleanupConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  username: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B13 Agent authentication integration tests`);
  return value;
}

function assertFullIntegrationMode(config: PlatformRuntimeConfig): void {
  const databaseUrl = new URL(requiredEnvironment('DATABASE_URL'));
  if (mode !== 'full' || process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    throw new TypeError('Full B13 Agent tests require the explicit ephemeral CI capability');
  }
  let username: string;
  let databaseName: string;
  try {
    username = decodeURIComponent(databaseUrl.username);
    databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    throw new TypeError('B13 Agent DATABASE_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(databaseUrl.hostname) || username !== 'mall_runtime' ||
    !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
    throw new TypeError('Full B13 Agent tests require a query-free loopback mall_runtime test DB');
  }
  const redisUrl = new URL(config.redis.url);
  if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
    decodeURIComponent(redisUrl.password).length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
    throw new TypeError('Full B13 Agent tests require a password-authenticated loopback Redis');
  }
}

function rollbackDatabaseRuntime(): DatabaseRuntime {
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13 Agent tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b131-agent-auth-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl: requiredEnvironment('DATABASE_URL'),
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function cleanupConnectionForFull(): FullCleanupConnection {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let username: string;
  let databaseName: string;
  let password: string;
  try {
    username = decodeURIComponent(directUrl.username);
    databaseName = decodeURIComponent(directUrl.pathname.slice(1));
    password = decodeURIComponent(directUrl.password);
  } catch {
    throw new TypeError('B13 Agent DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || username !== 'mall_migrator' ||
    !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname ||
    (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B13 Agent cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function paymentFixture(now = new Date()): PaymentFixture {
  const id = (offset: number) => generateUlid(now.getTime() - offset);
  const paymentIntentId = id(1_000);
  return {
    accountId: id(15_000),
    addressId: id(3_900),
    attributionId: id(3_800),
    balanceId: id(8_000),
    bindingId: id(14_000),
    brandId: id(12_000),
    categoryId: id(11_000),
    commissionEntryId: id(1_800),
    commissionVersionId: id(1_900),
    customerId: id(13_000),
    inventoryLedgerId: id(3_600),
    orderId: id(6_000),
    orderItemId: id(5_000),
    paymentIntentId,
    productId: id(10_000),
    providerIntentId: `mock-${paymentIntentId}`,
    reservationId: id(4_000),
    reservationItemId: id(3_700),
    skuId: id(9_000),
  };
}

function expectNoStore(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function rateKeys(config: PlatformRuntimeConfig, loginName: string): string[] {
  const normalizedLogin = loginName.normalize('NFKC').toLocaleLowerCase('en-US');
  const subject = hmacAuthenticationIdentity(
    { login_name: normalizedLogin },
    config.encryption.ipHashKey,
    'agent-login-subject',
  );
  const sourceIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  return [
    `qingxu:agent-login:subject:${subject}`,
    ...sourceIps.map((ipAddress) => `qingxu:agent-login:source:${hmacAuthenticationIdentity(
      { ip_address: ipAddress },
      config.encryption.ipHashKey,
      'agent-login-source',
    )}`),
  ];
}

function agentLoginRedisKeys(
  config: PlatformRuntimeConfig,
  loginNames: readonly string[],
  idempotencyKeys: readonly string[],
): string[] {
  const rate = loginNames.flatMap((loginName) => rateKeys(config, loginName));
  const inflight = rate.flatMap((key) => [
    key.replace(':agent-login:subject:', ':agent-login:inflight:subject:')
      .replace(':agent-login:source:', ':agent-login:inflight:source:'),
  ]);
  return [...new Set([
    ...rate,
    ...inflight,
    ...idempotencyKeys.flatMap((key) => [
      `qingxu:agent-login:attempt:${key.toLowerCase()}`,
      `qingxu:agent-login:inflight:${key.toLowerCase()}`,
    ]),
  ])];
}

async function clearAgentLoginRedis(
  redis: ApiRedisClient,
  config: PlatformRuntimeConfig,
  loginNames: readonly string[],
  idempotencyKeys: readonly string[],
): Promise<void> {
  const keys = agentLoginRedisKeys(config, loginNames, idempotencyKeys);
  if (keys.length === 0) return;
  await redis.eval(`for _, key in ipairs(KEYS) do redis.call('DEL', key) end return #KEYS`, {
    arguments: [],
    keys,
  });
}

async function countAgentLoginRedis(
  redis: ApiRedisClient,
  config: PlatformRuntimeConfig,
  loginNames: readonly string[],
  idempotencyKeys: readonly string[],
): Promise<number> {
  const keys = agentLoginRedisKeys(config, loginNames, idempotencyKeys);
  if (keys.length === 0) return 0;
  return Number(await redis.eval(
    `local total = 0
     for _, key in ipairs(KEYS) do total = total + redis.call('EXISTS', key) end
     return total`,
    { arguments: [], keys },
  ));
}

async function rateCounts(redis: ApiRedisClient, config: PlatformRuntimeConfig, loginName: string) {
  const keys = rateKeys(config, loginName);
  const values = await Promise.all(keys.map((key) => redis.eval(
    `return redis.call('GET', KEYS[1])`,
    { arguments: [], keys: [key] },
  )));
  return {
    source: values.slice(1).reduce<number>((total, value) => total + Number(value ?? 0), 0),
    subject: Number(values[0] ?? 0),
  };
}

function adminContext(
  accountId: string,
  sessionId: string,
  factorId: string,
): AdminAgentRequestContext {
  const requestId = `req_${randomUUID().replaceAll('-', '')}`;
  return {
    accessSession: {
      accountId,
      accountVersion: 1,
      accessJti: `access:${generateUlid()}`,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      factorEncryptionKeyId: 'b131-field-v1',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array([1, 2, 3]),
      mfaVerifiedAt: new Date(),
      sessionFamily: generateUlid(),
      sessionId,
    },
    principal: {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
    },
    requestId,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function seedAdmin(
  database: DatabaseRuntime,
  input: { accountId: string; factorId: string; sessionId: string },
): Promise<void> {
  const { accountId, factorId, sessionId } = input;
  const now = new Date();
  await database.prisma.account.create({
    data: {
      id: accountId,
      login_name: `b131-admin-${accountId}`,
      password_hash: await hashPassword(randomBytes(32).toString('base64url')),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  await database.prisma.totpFactor.create({
    data: {
      account_id: accountId,
      encryption_key_id: 'b131-field-v1',
      id: factorId,
      label: 'B13.1 integration factor',
      secret_ciphertext: Buffer.from('b131-encrypted-factor'),
      secret_fingerprint: digest(`b131-factor-${factorId}`),
      status: 'ACTIVE',
      verified_at: now,
    },
  });
  await database.prisma.authSession.create({
    data: {
      access_jti: `access:${generateUlid()}`,
      account_id: accountId,
      assurance: 'MFA',
      created_at: now,
      expires_at: new Date(now.getTime() + 60 * 60_000),
      id: sessionId,
      mfa_factor_id: factorId,
      mfa_verified_at: now,
      refresh_token_hash: digest(`b131-admin-refresh-${sessionId}`),
      restriction: 'NONE',
      rotation_counter: 0,
      session_family: generateUlid(),
    },
  });
}

async function seedPayment(
  transaction: DatabaseTransaction,
  fixture: PaymentFixture,
  agentId: string,
  adminAccountId: string,
  now = new Date(),
  options: { createCommissionRule?: boolean } = {},
): Promise<void> {
  const createCommissionRule = options.createCommissionRule ?? true;
  const expiresAt = new Date(now.getTime() + 30 * 60_000);
  if (createCommissionRule) {
    const published = await transaction.commissionRuleVersion.count({ where: { status: 'PUBLISHED' } });
    if (published !== 0) {
      throw new TypeError('B13 Agent payment race requires a dedicated ephemeral DB without published commission rules');
    }
    const maximumVersion = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
    const versionNo = (maximumVersion._max.version_no ?? 0) + 1;
    await transaction.commissionRuleVersion.create({
      data: {
        created_by_id: adminAccountId,
        effective_at: null,
        id: fixture.commissionVersionId,
        reason: 'B13.1 payment and disable integration',
        status: 'DRAFT',
        version_no: versionNo,
      },
    });
    await transaction.commissionRuleEntry.create({
      data: {
        configured_rate: '0.0000',
        id: fixture.commissionEntryId,
        rule_version_id: fixture.commissionVersionId,
        target_id: null,
        target_key: 'PLATFORM',
        target_type: 'PLATFORM',
      },
    });
    await transaction.commissionRuleVersion.update({
      data: { effective_at: new Date(now.getTime() - 60_000), status: 'PUBLISHED' },
      where: { id: fixture.commissionVersionId },
    });
  }
  await transaction.account.create({
    data: {
      id: fixture.accountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      wechat_open_id: `b131-customer-${fixture.accountId}`,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.accountId,
      id: fixture.customerId,
      nickname: 'Fixture Customer',
      registered_at: now,
    },
  });
  await transaction.customerPhoneVerification.create({
    data: {
      consent_version: 'b131-phone-v1',
      customer_id: fixture.customerId,
      encryption_key_id: 'b131-field-v1',
      id: generateUlid(now.getTime() - 12_500),
      phone_ciphertext: Buffer.from(`b131-phone-${fixture.customerId}`),
      phone_hash: digest(`b131-phone-${fixture.customerId}`),
      phone_last4: '4826',
      source: 'B13_INTEGRATION',
      verified_at: new Date(now.getTime() - 60_000),
    },
  });
  await transaction.customerAgentBinding.create({
    data: {
      agent_id: agentId,
      customer_id: fixture.customerId,
      id: fixture.bindingId,
      started_at: new Date(now.getTime() - 120_000),
    },
  });
  await transaction.brand.create({
    data: { id: fixture.brandId, name: `B131 Brand ${fixture.brandId}`, status: 'ACTIVE' },
  });
  await transaction.category.create({
    data: { id: fixture.categoryId, name: `B131 Category ${fixture.categoryId}`, status: 'ACTIVE' },
  });
  await transaction.product.create({
    data: {
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      id: fixture.productId,
      name: `B131 Product ${fixture.productId}`,
      published_at: now,
      sales_count: 0,
      spu_code: `B131-SPU-${fixture.productId}`,
      status: 'ACTIVE',
    },
  });
  await transaction.sku.create({
    data: {
      code: `B131-SKU-${fixture.skuId}`,
      id: fixture.skuId,
      name: 'B13.1 Payment SKU',
      product_id: fixture.productId,
      retail_price: '19.90',
      status: 'ACTIVE',
    },
  });
  await transaction.inventoryBalance.create({
    data: { id: fixture.balanceId, locked_qty: 1, physical_qty: 5, sku_id: fixture.skuId, version: 1 },
  });
  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: fixture.customerId,
      fulfillment_status: 'NOT_STARTED',
      goods_amount: '19.90',
      id: fixture.orderId,
      order_no: `QX${fixture.orderId}`,
      order_status: 'PENDING_PAYMENT',
      paid_amount: '0.00',
      pay_expires_at: expiresAt,
      payable_amount: '19.90',
      payment_resolution: 'NORMAL',
      payment_status: 'PROCESSING',
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
      brand_name_snapshot: `B131 Brand ${fixture.brandId}`,
      category_id: fixture.categoryId,
      category_name_snapshot: `B131 Category ${fixture.categoryId}`,
      id: fixture.orderItemId,
      line_paid_amount: '19.90',
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: fixture.productId,
      product_name_snapshot: `B131 Product ${fixture.productId}`,
      quantity: 1,
      refunded_amount: '0.00',
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B131-SKU-${fixture.skuId}`,
      sku_id: fixture.skuId,
      sku_name_snapshot: 'B13.1 Payment SKU',
      unit_price: '19.90',
      version: 1,
    },
  });
  await transaction.orderAddressSnapshot.create({
    data: {
      city: 'Auckland',
      detail_ciphertext: Buffer.from(`b131-detail-${fixture.orderId}`),
      district: 'Central',
      encryption_key_id: 'b131-field-v1',
      id: fixture.addressId,
      order_id: fixture.orderId,
      phone_ciphertext: Buffer.from(`b131-address-phone-${fixture.orderId}`),
      phone_last4: '2468',
      province: 'Auckland',
      recipient_name: 'B13.1 Payment Recipient',
    },
  });
  await transaction.orderAttributionCandidate.create({
    data: {
      binding_id: fixture.bindingId,
      candidate_agent_id: agentId,
      id: fixture.attributionId,
      order_id: fixture.orderId,
      submit_channel: 'AGENT',
      submitted_at: new Date(now.getTime() - 30_000),
    },
  });
  await transaction.inventoryReservation.create({
    data: { expires_at: expiresAt, id: fixture.reservationId, order_id: fixture.orderId, status: 'ACTIVE' },
  });
  await transaction.inventoryReservationItem.create({
    data: {
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
      id: fixture.inventoryLedgerId,
      ledger_type: 'ORDER_RESERVE',
      locked_after: 1,
      locked_change: 1,
      physical_after: 5,
      physical_change: 0,
      reason: 'ORDER_RESERVE',
      sku_id: fixture.skuId,
    },
  });
  await transaction.paymentIntent.create({
    data: {
      amount: '19.90',
      create_requested_at: new Date(now.getTime() - 120_000),
      expires_at: expiresAt,
      id: fixture.paymentIntentId,
      intent_no: `PI${fixture.paymentIntentId}`,
      next_reconcile_at: new Date(now.getTime() + 60_000),
      opened_at: new Date(now.getTime() - 90_000),
      order_id: fixture.orderId,
      provider: 'MOCK',
      provider_intent_id: fixture.providerIntentId,
      provider_state: 'OPEN',
      status: 'OPEN',
      version: 1,
    },
  });
}

interface AgentLockBarrier {
  acquired?: Deferred<void>;
  attempted?: Deferred<void>;
  release?: Deferred<void>;
}

function isAgentLock(query: string, values: readonly unknown[], agentId: string): boolean {
  return query.includes('pg_advisory_xact_lock') &&
    values[0] === 'store-attribution-agent' && values[1] === JSON.stringify([agentId]);
}

function transactionWithAgentLockBarrier(
  transaction: DatabaseTransaction,
  agentId: string,
  barrier: AgentLockBarrier,
): DatabaseTransaction {
  return new Proxy(transaction, {
    get(target, property) {
      if (property === '$queryRawUnsafe') {
        return async (query: string, ...values: unknown[]) => {
          if (!isAgentLock(query, values, agentId)) return target.$queryRawUnsafe(query, ...values);
          const pending = target.$queryRawUnsafe(query, ...values);
          barrier.attempted?.resolve();
          const result = await pending;
          barrier.acquired?.resolve();
          if (barrier.release) await barrier.release.promise;
          return result as unknown;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function databaseWithAgentLockBarrier(
  database: DatabaseRuntime,
  agentId: string,
  barrier: AgentLockBarrier,
): DatabaseRuntime {
  const prisma = new Proxy(database.prisma, {
    get(target, property) {
      if (property === '$transaction') {
        const transactionMethod: unknown = Reflect.get(target, property, target);
        if (typeof transactionMethod !== 'function') throw new TypeError('Prisma transaction method is unavailable');
        return (work: unknown, ...options: unknown[]) => {
          if (typeof work !== 'function') {
            throw new TypeError('Agent lock barrier requires an interactive Prisma transaction');
          }
          const transactionWork = work as (transaction: DatabaseTransaction) => unknown;
          return Reflect.apply(transactionMethod, target, [
            (transaction: DatabaseTransaction) => transactionWork(
              transactionWithAgentLockBarrier(transaction, agentId, barrier),
            ),
            ...options,
          ]);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prisma') return prisma;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function observeBlockedAdvisoryLockPairs(database: DatabaseRuntime): Promise<number> {
  for (let observation = 0; observation < 200; observation += 1) {
    const result = await database.pool.query<{ blocked_count: number }>(`
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

function cleanupFullFixture(
  connection: FullCleanupConnection,
  input: {
    adminAccountId: string;
    agentAccountId: string;
    agentId: string;
    idempotencyKeys: readonly string[];
    loginName: string;
    payments: readonly PaymentFixture[];
  },
): void {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_admin_id=${input.adminAccountId}`,
    '-v', `fixture_agent_account_id=${input.agentAccountId}`,
    '-v', `fixture_agent_id=${input.agentId}`,
    '-v', `fixture_keys=${input.idempotencyKeys.join(',')}`,
    '-v', `fixture_login_name=${input.loginName}`,
    '-v', `fixture_order_ids=${input.payments.map(({ orderId }) => orderId).join(',')}`,
    '-v', `fixture_customer_ids=${input.payments.map(({ customerId }) => customerId).join(',')}`,
    '-v', `fixture_customer_account_ids=${input.payments.map(({ accountId }) => accountId).join(',')}`,
    '-v', `fixture_sku_ids=${input.payments.map(({ skuId }) => skuId).join(',')}`,
    '-v', `fixture_product_ids=${input.payments.map(({ productId }) => productId).join(',')}`,
    '-v', `fixture_category_ids=${input.payments.map(({ categoryId }) => categoryId).join(',')}`,
    '-v', `fixture_brand_ids=${input.payments.map(({ brandId }) => brandId).join(',')}`,
    '-v', `fixture_rule_ids=${input.payments.map(({ commissionVersionId }) => commissionVersionId).join(',')}`,
    '-qAt',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGDATABASE: connection.database,
      PGHOST: connection.host,
      PGPASSWORD: connection.password,
      PGPORT: connection.port,
      PGSSLMODE: 'disable',
      PGUSER: connection.username,
    },
    input: `
BEGIN;
DELETE FROM public.commission_ledger
  WHERE snapshot_id IN (
    SELECT id FROM public.order_item_commission_snapshot
    WHERE order_item_id IN (
      SELECT id FROM public.order_item
      WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
    )
  );
DELETE FROM public.order_item_commission_position
  WHERE snapshot_id IN (
    SELECT id FROM public.order_item_commission_snapshot
    WHERE order_item_id IN (
      SELECT id FROM public.order_item
      WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
    )
  );
DELETE FROM public.agent_customer_privacy_projection
  WHERE attribution_snapshot_id IN (
    SELECT id FROM public.order_attribution_snapshot
    WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
  );
DELETE FROM public.order_item_commission_snapshot
  WHERE order_item_id IN (
    SELECT id FROM public.order_item
    WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
  );
DELETE FROM public.order_attribution_snapshot
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.payment_attempt
  WHERE payment_intent_id IN (
    SELECT id FROM public.payment_intent
    WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
  );
DELETE FROM public.payment_intent
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.inventory_ledger
  WHERE sku_id = ANY(string_to_array(:'fixture_sku_ids', ',')) OR business_id IN (
    SELECT id FROM public.inventory_reservation
    WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
  );
DELETE FROM public.inventory_reservation_item
  WHERE reservation_id IN (
    SELECT id FROM public.inventory_reservation
    WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','))
  );
DELETE FROM public.inventory_reservation
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.order_attribution_candidate
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.order_address_snapshot
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.order_item
  WHERE order_id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.sales_order
  WHERE id = ANY(string_to_array(:'fixture_order_ids', ','));
DELETE FROM public.customer_agent_binding
  WHERE customer_id = ANY(string_to_array(:'fixture_customer_ids', ','));
DELETE FROM public.customer_phone_verification
  WHERE customer_id = ANY(string_to_array(:'fixture_customer_ids', ','));
DELETE FROM public.customer_profile
  WHERE id = ANY(string_to_array(:'fixture_customer_ids', ','));
DELETE FROM public.inventory_balance
  WHERE sku_id = ANY(string_to_array(:'fixture_sku_ids', ','));
DELETE FROM public.sku WHERE id = ANY(string_to_array(:'fixture_sku_ids', ','));
DELETE FROM public.product WHERE id = ANY(string_to_array(:'fixture_product_ids', ','));
DELETE FROM public.category WHERE id = ANY(string_to_array(:'fixture_category_ids', ','));
DELETE FROM public.brand WHERE id = ANY(string_to_array(:'fixture_brand_ids', ','));
ALTER TABLE public.commission_rule_entry DISABLE TRIGGER trg_commission_rule_entry_append_only;
DELETE FROM public.commission_rule_entry
  WHERE rule_version_id = ANY(string_to_array(:'fixture_rule_ids', ','));
ALTER TABLE public.commission_rule_entry ENABLE TRIGGER trg_commission_rule_entry_append_only;
DELETE FROM public.commission_rule_version
  WHERE id = ANY(string_to_array(:'fixture_rule_ids', ','));
DELETE FROM public.account
  WHERE id = ANY(string_to_array(:'fixture_customer_account_ids', ','));
DELETE FROM public.high_risk_operation_preview
  WHERE actor_account_id = :'fixture_admin_id' OR target_id = :'fixture_agent_id';
DELETE FROM public.outbox_event WHERE aggregate_id = :'fixture_agent_id';
DELETE FROM public.audit_log
  WHERE actor_account_id = :'fixture_admin_id'
     OR object_id = :'fixture_agent_id'
     OR actor_account_id = :'fixture_agent_account_id'
     OR idempotency_key = ANY(string_to_array(:'fixture_keys', ','));
DELETE FROM public.idempotency_record
  WHERE idempotency_key = ANY(string_to_array(:'fixture_keys', ','));
DELETE FROM public.auth_session
  WHERE account_id = :'fixture_admin_id'
     OR account_id = :'fixture_agent_account_id'
     OR account_id IN (SELECT id FROM public.account WHERE login_name = :'fixture_login_name');
DELETE FROM public.agent_invite_code
  WHERE agent_id = :'fixture_agent_id'
     OR agent_id IN (
       SELECT id FROM public.agent_profile
       WHERE account_id IN (SELECT id FROM public.account WHERE login_name = :'fixture_login_name')
     );
DELETE FROM public.agent_wallet
  WHERE agent_id = :'fixture_agent_id'
     OR agent_id IN (
       SELECT id FROM public.agent_profile
       WHERE account_id IN (SELECT id FROM public.account WHERE login_name = :'fixture_login_name')
     );
DELETE FROM public.agent_profile
  WHERE id = :'fixture_agent_id'
     OR account_id = :'fixture_agent_account_id'
     OR account_id IN (SELECT id FROM public.account WHERE login_name = :'fixture_login_name');
DELETE FROM public.account
  WHERE id = :'fixture_agent_account_id' OR login_name = :'fixture_login_name';
DELETE FROM public.totp_factor WHERE account_id = :'fixture_admin_id';
DELETE FROM public.account WHERE id = :'fixture_admin_id';
COMMIT;
SELECT (
  (SELECT COUNT(*) FROM public.account
    WHERE id IN (:'fixture_admin_id', :'fixture_agent_account_id')
       OR id = ANY(string_to_array(:'fixture_customer_account_ids', ','))
       OR login_name = :'fixture_login_name') +
  (SELECT COUNT(*) FROM public.agent_profile WHERE id = :'fixture_agent_id') +
  (SELECT COUNT(*) FROM public.sales_order
    WHERE id = ANY(string_to_array(:'fixture_order_ids', ','))) +
  (SELECT COUNT(*) FROM public.commission_rule_version
    WHERE id = ANY(string_to_array(:'fixture_rule_ids', ','))) +
  (SELECT COUNT(*) FROM public.idempotency_record
    WHERE idempotency_key = ANY(string_to_array(:'fixture_keys', ','))) +
  (SELECT COUNT(*) FROM public.audit_log
    WHERE actor_account_id IN (:'fixture_admin_id', :'fixture_agent_account_id')
       OR object_id = :'fixture_agent_id'
       OR idempotency_key = ANY(string_to_array(:'fixture_keys', ','))) +
  (SELECT COUNT(*) FROM public.outbox_event WHERE aggregate_id = :'fixture_agent_id') +
  (SELECT COUNT(*) FROM public.high_risk_operation_preview
    WHERE actor_account_id = :'fixture_admin_id' OR target_id = :'fixture_agent_id')
)::bigint AS residual_count;
`,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`B13 Agent integration cleanup failed: ${result.stderr || result.error?.message || 'unknown error'}`);
  }
  if (result.stdout.trim() !== '0') {
    throw new Error(`B13 Agent integration cleanup left ${result.stdout.trim() || 'unknown'} database facts`);
  }
}

integrationDescribe('B13.1 Agent lifecycle and authentication PostgreSQL/Redis integration', () => {
  let app!: INestApplication;
  let config!: PlatformRuntimeConfig;
  let database!: DatabaseRuntime;
  let redis!: ApiRedisClient;
  let adminAgents!: AdminAgentsService;
  let adminAccountId = '00000000000000000000000000';
  let adminFactorId = '00000000000000000000000000';
  let adminSessionId = '00000000000000000000000000';
  let agentId = '00000000000000000000000000';
  let agentAccountId = '00000000000000000000000000';
  const loginName = `b131-agent-${generateUlid()}`.slice(0, 80).toLowerCase();
  const unknownLoginName = `b131-missing-${generateUlid()}`.slice(0, 80).toLowerCase();
  const wrongPassword = `Wrong!${randomBytes(24).toString('base64url')}`;
  const permanentPassword = `Permanent!${randomBytes(24).toString('base64url')}`;
  const updatedPassword = `Updated!${randomBytes(24).toString('base64url')}`;
  const payment = paymentFixture();
  const disabledFirstPayment = paymentFixture(new Date(Date.now() - 60_000));
  const idempotencyKeys: string[] = [];

  function key(): string {
    const value = randomUUID();
    idempotencyKeys.push(value);
    return value;
  }

  beforeAll(async () => {
    if (mode === 'rollback') {
      database = rollbackDatabaseRuntime();
      await database.connect();
      return;
    }
    config = loadPlatformConfig(process.env, { service: 'api' });
    assertFullIntegrationMode(config);
    Reflect.defineMetadata('design:paramtypes', [Object, Object], AgentLoginRateLimiter);
    Reflect.defineMetadata('design:paramtypes', [Object, Object, AgentLoginRateLimiter], AgentAuthService);
    Reflect.defineMetadata('design:paramtypes', [AgentAuthService], AgentAuthController);
    Reflect.defineMetadata('design:paramtypes', [Object, Object], AdminAgentsService);
    const moduleRef = await Test.createTestingModule({
      imports: [ApiRuntimeModule.register(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    database = app.get(API_DATABASE_RUNTIME);
    redis = app.get(API_REDIS_CLIENT);
    adminAgents = app.get(AdminAgentsService);
    expect(await redis.eval(`return redis.call('PING')`, { arguments: [], keys: [] })).toBe('PONG');
    if (mode === 'full') {
      const admin = { accountId: generateUlid(), factorId: generateUlid(), sessionId: generateUlid() };
      adminAccountId = admin.accountId;
      adminFactorId = admin.factorId;
      adminSessionId = admin.sessionId;
      await seedAdmin(database, admin);
    }
  }, 60_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (mode === 'full' && redis && config) {
        await clearAgentLoginRedis(redis, config, [loginName, unknownLoginName], idempotencyKeys);
        const residualRedis = await countAgentLoginRedis(
          redis,
          config,
          [loginName, unknownLoginName],
          idempotencyKeys,
        );
        if (residualRedis !== 0) {
          throw new Error(`B13 Agent integration cleanup left ${String(residualRedis)} Redis keys`);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (mode === 'full' && adminAccountId !== '00000000000000000000000000') {
        cleanupFullFixture(cleanupConnectionForFull(), {
          adminAccountId,
          agentAccountId,
          agentId,
          idempotencyKeys,
          loginName,
          payments: [payment, disabledFirstPayment],
        });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (mode === 'rollback' && database) await database.disconnect();
      else if (app) await app.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'B13 Agent integration cleanup failed');
    }
  }, 60_000);

  rollbackIt('rolls Agent account, restricted session, password change, and disable facts back atomically', async () => {
    const now = new Date();
    const rollbackAgentId = generateUlid(now.getTime() - 4_000);
    const rollbackAccountId = generateUlid(now.getTime() - 5_000);
    const repository = new AdminAgentRepository(database.prisma, () => now);
    const auth = new AgentAuthRepository(database.prisma, () => now);
    await expect(database.withPrismaTransaction(async (transaction) => {
      await repository.createAgentInTransaction(transaction, {
        accountId: rollbackAccountId,
        agentId: rollbackAgentId,
        agentNo: `AGT-${rollbackAgentId}`,
        contactName: 'Rollback Agent',
        contactPhone: null,
        inviteCode: {
          ciphertext: Buffer.from('b131-rollback-encrypted-invite'),
          codeHash: digest(`b131-invite-${rollbackAgentId}`),
          encryptionKeyId: 'b131-field-v1',
          expiresAt: null,
          last4: '4826',
        },
        inviteCodeId: generateUlid(now.getTime() - 2_000),
        loginName: `rollback-${rollbackAgentId}`.slice(0, 80).toLowerCase(),
        name: 'B13.1 Rollback Agent',
        passwordHash: `$argon2id$v=19$m=65536,t=3,p=1$${digest('b131-old-password')}`,
        productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
        walletId: generateUlid(now.getTime() - 3_000),
      });
      const restrictedSessionId = generateUlid(now.getTime() - 1_000);
      const restricted = await auth.createLoginSessionInTransaction(transaction, {
        accountId: rollbackAccountId,
        expectedMustChangePassword: true,
        expectedPasswordHash: `$argon2id$v=19$m=65536,t=3,p=1$${digest('b131-old-password')}`,
        expectedVersion: 1,
        session: {
          accessJti: `access:${generateUlid()}`,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          id: restrictedSessionId,
          refreshTokenHash: null,
          restriction: 'CHANGE_PASSWORD_ONLY',
          sessionFamily: generateUlid(),
        },
      });
      expect(restricted.restriction).toBe('CHANGE_PASSWORD_ONLY');
      const changed = await auth.changeTemporaryPasswordInTransaction(transaction, {
        accountId: rollbackAccountId,
        currentSessionId: restrictedSessionId,
        expectedPasswordHash: `$argon2id$v=19$m=65536,t=3,p=1$${digest('b131-old-password')}`,
        expectedVersion: 1,
        newPasswordHash: `$argon2id$v=19$m=65536,t=3,p=1$${digest('b131-new-password')}`,
        session: {
          accessJti: `access:${generateUlid()}`,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          id: generateUlid(),
          refreshTokenHash: digest('b131-rollback-refresh'),
          restriction: 'NONE',
          sessionFamily: generateUlid(),
        },
      });
      expect(changed.version).toBe(2);
      const disabled = await repository.disableAgentInTransaction(transaction, {
        agentId: rollbackAgentId,
        expectedVersion: 1,
      });
      expect(disabled.agent).toMatchObject({ accountStatus: 'DISABLED', status: 'DISABLED', version: 2 });
      expect(await transaction.authSession.count({
        where: { account_id: rollbackAccountId, revoked_at: null },
      })).toBe(0);
      throw rollbackSentinel;
    }, prismaTransactionOptions)).rejects.toBe(rollbackSentinel);

    expect(await database.prisma.account.count({ where: { id: rollbackAccountId } })).toBe(0);
    expect(await database.prisma.agentProfile.count({ where: { id: rollbackAgentId } })).toBe(0);
    expect(await database.prisma.agentWallet.count({ where: { agent_id: rollbackAgentId } })).toBe(0);
  }, 150_000);

  fullIt('closes create, restricted login, password, refresh, payment-disable, reactivate, and reset', async () => {
    const context = () => adminContext(adminAccountId, adminSessionId, adminFactorId);
    const createKey = key();
    const created = await adminAgents.create(context(), {
      contactName: 'B13.1 Agent Operator',
      contactPhone: '13800138000',
      loginName,
      name: 'B13.1 Integration Agent',
      productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    }, createKey);
    expect(created).toMatchObject({
      agent: { status: 'ACTIVE', version: 1 },
      disclosure_state: 'FIRST_ISSUE',
      must_change_password: true,
      reissue_required: false,
    });
    expect(created.temporary_password).toMatch(/^Tmp!9[A-Za-z0-9_-]+$/);
    expect(created.initial_invite_code?.code).toMatch(/^AGT-[A-Za-z0-9_-]+$/);
    agentId = created.agent.agent_id;
    const temporaryPassword = created.temporary_password as string;
    const initialInviteCode = created.initial_invite_code?.code as string;
    const storedAgent = await database.prisma.agentProfile.findUniqueOrThrow({ where: { id: agentId } });
    agentAccountId = storedAgent.account_id;

    const createReplay = await adminAgents.create(context(), {
      contactName: 'B13.1 Agent Operator',
      contactPhone: '13800138000',
      loginName,
      name: 'B13.1 Integration Agent',
      productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    }, createKey);
    expect(createReplay).toMatchObject({
      agent: { agent_id: agentId },
      disclosure_state: 'REPLAY_REDACTED',
      expires_at: null,
      initial_invite_code: null,
      reissue_required: true,
      temporary_password: null,
    });
    expect(await database.prisma.agentProfile.count({ where: { id: agentId } })).toBe(1);

    await clearAgentLoginRedis(redis, config, [loginName, unknownLoginName], idempotencyKeys);
    const unknownKey = key();
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', unknownKey)
      .send({ login_name: unknownLoginName, password: wrongPassword });
    expect(unknown.status).toBe(401);
    expectNoStore(unknown);
    const markerKey = `qingxu:agent-login:attempt:${unknownKey}`;
    expect(await redis.eval(`return redis.call('GET', KEYS[1])`, {
      arguments: [], keys: [markerKey],
    })).toBe('1');
    expect(Number(await redis.eval(`return redis.call('PTTL', KEYS[1])`, {
      arguments: [], keys: [markerKey],
    }))).toBeGreaterThan(0);
    const unknownCounts = await rateCounts(redis, config, unknownLoginName);
    expect(unknownCounts).toEqual({ source: 1, subject: 1 });

    const unknownReplay = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', unknownKey)
      .send({ login_name: unknownLoginName, password: wrongPassword });
    expect(unknownReplay.status).toBe(401);
    expectNoStore(unknownReplay);
    expect(await rateCounts(redis, config, unknownLoginName)).toEqual(unknownCounts);

    await clearAgentLoginRedis(redis, config, [loginName, unknownLoginName], idempotencyKeys);
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: wrongPassword });
    expect(wrong.status).toBe(401);
    expectNoStore(wrong);
    expect({ code: wrong.body.code, message: wrong.body.message })
      .toEqual({ code: unknown.body.code, message: unknown.body.message });

    if (config.agent.loginRateLimitMax > 20) {
      throw new TypeError('B13 Agent integration requires AGENT_LOGIN_RATE_LIMIT_MAX <= 20');
    }
    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    let thresholdResponse: request.Response | undefined;
    let thresholdKey = '';
    for (let attempt = 1; attempt <= config.agent.loginRateLimitMax; attempt += 1) {
      thresholdKey = key();
      thresholdResponse = await request(app.getHttpServer())
        .post('/api/v1/agent/auth/login')
        .set('Idempotency-Key', thresholdKey)
        .send({ login_name: loginName, password: wrongPassword });
      expect(thresholdResponse.status).toBe(attempt === config.agent.loginRateLimitMax ? 429 : 401);
      expectNoStore(thresholdResponse);
    }
    expect(thresholdResponse).toBeDefined();
    expect(await rateCounts(redis, config, loginName)).toEqual({
      source: config.agent.loginRateLimitMax,
      subject: config.agent.loginRateLimitMax,
    });
    const thresholdReplay = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', thresholdKey)
      .send({ login_name: loginName, password: wrongPassword });
    expect(thresholdReplay.status).toBe(429);
    expectNoStore(thresholdReplay);
    expect(await rateCounts(redis, config, loginName)).toEqual({
      source: config.agent.loginRateLimitMax,
      subject: config.agent.loginRateLimitMax,
    });

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const temporaryLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName.toUpperCase(), password: temporaryPassword })
      .expect(200);
    expectNoStore(temporaryLogin);
    expect(temporaryLogin.body.data).toMatchObject({
      account_id: agentAccountId,
      allowed_actions: ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'],
      must_change_password: true,
      next_action: 'CHANGE_PASSWORD',
      restriction: 'CHANGE_PASSWORD_ONLY',
      role: 'AGENT_ADMIN',
    });
    expect(temporaryLogin.body.data).not.toHaveProperty('refresh_token');
    const restrictedAccessToken = temporaryLogin.body.data.access_token as string;

    const restrictedCurrent = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${restrictedAccessToken}`);
    expect(restrictedCurrent.status).toBe(403);
    expect(restrictedCurrent.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expectNoStore(restrictedCurrent);

    const restrictedSessionId = temporaryLogin.body.data.session_id as string;
    const [restrictedAccountBefore, restrictedSessionsBefore] = await Promise.all([
      database.prisma.account.findUniqueOrThrow({ where: { id: agentAccountId } }),
      database.prisma.authSession.findMany({
        where: { account_id: agentAccountId },
        select: {
          access_jti: true,
          id: true,
          refresh_token_hash: true,
          restriction: true,
          revoked_at: true,
          session_family: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    expect(restrictedSessionsBefore).toEqual([
      expect.objectContaining({
        id: restrictedSessionId,
        refresh_token_hash: null,
        restriction: 'CHANGE_PASSWORD_ONLY',
        revoked_at: null,
      }),
    ]);
    const sameTemporaryPasswordKey = key();
    const sameTemporaryPassword = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', `Bearer ${restrictedAccessToken}`)
      .set('Idempotency-Key', sameTemporaryPasswordKey)
      .send({ current_password: temporaryPassword, new_password: temporaryPassword });
    expect(sameTemporaryPassword.status).toBe(400);
    expect(sameTemporaryPassword.body.code).toBe('INVALID_ARGUMENT');
    expect(sameTemporaryPassword.body).not.toHaveProperty('data');
    expectNoStore(sameTemporaryPassword);
    const [restrictedAccountAfter, restrictedSessionsAfter, rejectedIdempotency, rejectedAudit] = await Promise.all([
      database.prisma.account.findUniqueOrThrow({ where: { id: agentAccountId } }),
      database.prisma.authSession.findMany({
        where: { account_id: agentAccountId },
        select: {
          access_jti: true,
          id: true,
          refresh_token_hash: true,
          restriction: true,
          revoked_at: true,
          session_family: true,
        },
        orderBy: { id: 'asc' },
      }),
      database.prisma.idempotencyRecord.count({ where: { idempotency_key: sameTemporaryPasswordKey } }),
      database.prisma.auditLog.count({ where: { idempotency_key: sameTemporaryPasswordKey } }),
    ]);
    expect(restrictedAccountAfter).toMatchObject({
      must_change_password: true,
      password_hash: restrictedAccountBefore.password_hash,
      version: restrictedAccountBefore.version,
    });
    expect(restrictedSessionsAfter).toEqual(restrictedSessionsBefore);
    expect(rejectedIdempotency).toBe(0);
    expect(rejectedAudit).toBe(0);

    const temporaryChangeKey = key();
    const changed = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', `Bearer ${restrictedAccessToken}`)
      .set('Idempotency-Key', temporaryChangeKey)
      .send({ current_password: temporaryPassword, new_password: permanentPassword })
      .expect(200);
    expectNoStore(changed);
    expect(changed.body.data).toMatchObject({
      account_id: agentAccountId,
      assurance: 'PASSWORD',
      restriction: 'NONE',
      role: 'AGENT_ADMIN',
    });
    const firstAccessToken = changed.body.data.access_token as string;
    const firstRefreshToken = changed.body.data.refresh_token as string;

    const sensitiveChangeReplay = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', `Bearer ${restrictedAccessToken}`)
      .set('Idempotency-Key', temporaryChangeKey)
      .send({ current_password: temporaryPassword, new_password: permanentPassword });
    expect(sensitiveChangeReplay.status).toBe(401);
    expect(sensitiveChangeReplay.body.code).toBe('AUTH_REQUIRED');
    expectNoStore(sensitiveChangeReplay);

    const recoveredAfterLostChangeResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: permanentPassword })
      .expect(200);
    expectNoStore(recoveredAfterLostChangeResponse);
    expect(recoveredAfterLostChangeResponse.body.data).toMatchObject({
      account_id: agentAccountId,
      restriction: 'NONE',
    });
    const recoveredAccessToken = recoveredAfterLostChangeResponse.body.data.access_token as string;
    const recoveredRefreshToken = recoveredAfterLostChangeResponse.body.data.refresh_token as string;

    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(2);
    const regularChange = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-password')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .set('Idempotency-Key', key())
      .send({ current_password: permanentPassword, new_password: updatedPassword })
      .expect(200);
    expectNoStore(regularChange);
    expect(regularChange.body.data).toMatchObject({
      resource_id: agentAccountId,
      resource_type: 'account',
      status: 'ACTIVE',
      version: 3,
    });
    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(0);

    const revokedOtherAccess = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${recoveredAccessToken}`);
    expect(revokedOtherAccess.status).toBe(401);
    expectNoStore(revokedOtherAccess);
    const revokedOtherRefresh = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', key())
      .send({ refresh_token: recoveredRefreshToken });
    expect(revokedOtherRefresh.status).toBe(401);
    expectNoStore(revokedOtherRefresh);

    const revokedCurrentAccess = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${firstAccessToken}`);
    expect(revokedCurrentAccess.status).toBe(401);
    expectNoStore(revokedCurrentAccess);
    const revokedCurrentRefresh = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', key())
      .send({ refresh_token: firstRefreshToken });
    expect(revokedCurrentRefresh.status).toBe(401);
    expectNoStore(revokedCurrentRefresh);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const oldPasswordAfterChange = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: permanentPassword });
    expect(oldPasswordAfterChange.status).toBe(401);
    expectNoStore(oldPasswordAfterChange);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const postChangeLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    expectNoStore(postChangeLogin);
    const postChangeAccessToken = postChangeLogin.body.data.access_token as string;
    const postChangeRefreshToken = postChangeLogin.body.data.refresh_token as string;
    const current = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${postChangeAccessToken}`)
      .expect(200);
    expectNoStore(current);
    expect(current.body.data).toMatchObject({
      agent_id: agentId,
      agent_no: `AGT-${agentId}`,
      name: 'B13.1 Integration Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
    });

    const refreshKey = key();
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', refreshKey)
      .send({ refresh_token: postChangeRefreshToken })
      .expect(200);
    expectNoStore(refreshed);
    const rotatedAccessToken = refreshed.body.data.access_token as string;
    const rotatedRefreshToken = refreshed.body.data.refresh_token as string;

    const sameRefreshReplay = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', refreshKey)
      .send({ refresh_token: postChangeRefreshToken });
    expect(sameRefreshReplay.status).toBe(409);
    expectNoStore(sameRefreshReplay);
    await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(200);

    const oldRefreshReplay = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', key())
      .send({ refresh_token: postChangeRefreshToken });
    expect(oldRefreshReplay.status).toBe(401);
    expectNoStore(oldRefreshReplay);
    await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(401);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const logoutLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    const logoutAccessToken = logoutLogin.body.data.access_token as string;
    const logoutRefreshToken = logoutLogin.body.data.refresh_token as string;
    const loggedOut = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/logout')
      .set('Authorization', `Bearer ${logoutAccessToken}`)
      .set('Idempotency-Key', key())
      .send({})
      .expect(200);
    expectNoStore(loggedOut);
    expect(loggedOut.body.data).toMatchObject({
      resource_id: logoutLogin.body.data.session_id,
      resource_type: 'session',
      status: 'REVOKED',
      version: 1,
    });
    const loggedOutAccess = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${logoutAccessToken}`);
    expect(loggedOutAccess.status).toBe(401);
    expectNoStore(loggedOutAccess);
    const loggedOutRefresh = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', key())
      .send({ refresh_token: logoutRefreshToken });
    expect(loggedOutRefresh.status).toBe(401);
    expectNoStore(loggedOutRefresh);
    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(0);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const logoutAllFirstLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    const logoutAllSecondLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    const logoutAllFirstAccess = logoutAllFirstLogin.body.data.access_token as string;
    const logoutAllFirstRefresh = logoutAllFirstLogin.body.data.refresh_token as string;
    const logoutAllSecondAccess = logoutAllSecondLogin.body.data.access_token as string;
    const logoutAllSecondRefresh = logoutAllSecondLogin.body.data.refresh_token as string;
    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(2);
    const loggedOutAll = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/logout-all')
      .set('Authorization', `Bearer ${logoutAllFirstAccess}`)
      .set('Idempotency-Key', key())
      .send({})
      .expect(200);
    expectNoStore(loggedOutAll);
    expect(loggedOutAll.body.data).toMatchObject({
      resource_id: agentAccountId,
      resource_type: 'account',
      status: 'ACTIVE',
      version: 4,
    });
    for (const accessToken of [logoutAllFirstAccess, logoutAllSecondAccess]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/agent/auth/current')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(401);
      expectNoStore(response);
    }
    for (const refreshToken of [logoutAllFirstRefresh, logoutAllSecondRefresh]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/auth/refresh')
        .set('Idempotency-Key', key())
        .send({ refresh_token: refreshToken });
      expect(response.status).toBe(401);
      expectNoStore(response);
    }
    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(0);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const beforeDisableLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    const beforeDisableAccess = beforeDisableLogin.body.data.access_token as string;

    await runSerializableTransaction(database.prisma, async (transaction) => {
      await seedPayment(transaction, payment, agentId, adminAccountId);
      await seedPayment(transaction, disabledFirstPayment, agentId, adminAccountId, new Date(), {
        createCommissionRule: false,
      });
    }, transactionRetryOptions);
    const disableReason = 'B13.1 payment concurrency integration';
    const disablePreview = await adminAgents.previewDisable(context(), agentId, {
      reason: disableReason,
      targetStatus: 'DISABLED',
    }, key());
    expect(disablePreview.impact.metrics).toContainEqual(expect.objectContaining({
      key: 'pending_payment_orders',
      before: '2',
      after: '2',
    }));

    const paymentRepository = new StorePaymentRepository();
    const paymentLockAcquired = deferred<void>();
    const resumePayment = deferred<void>();
    const callback = runSerializableTransaction(database.prisma, (transaction) =>
      paymentRepository.applyPaymentCallbackInTransaction(
        transactionWithAgentLockBarrier(transaction, agentId, {
          acquired: paymentLockAcquired,
          release: resumePayment,
        }),
        {
          amount: '19.90',
          eventType: 'payment.succeeded',
          occurredAt: new Date(),
          outcome: 'SUCCEEDED',
          provider: 'MOCK',
          providerEventId: `b131-event-${payment.paymentIntentId}`,
          providerIntentId: payment.providerIntentId,
          providerTransactionId: `b131-transaction-${payment.paymentIntentId}`,
        },
      ), transactionRetryOptions);
    await paymentLockAcquired.promise;
    const disableLockAcquired = deferred<void>();
    const disableLockAttempted = deferred<void>();
    const paymentFirstAdminAgents = new AdminAgentsService(
      config,
      databaseWithAgentLockBarrier(database, agentId, {
        acquired: disableLockAcquired,
        attempted: disableLockAttempted,
      }),
    );
    let disableState: 'fulfilled' | 'pending' | 'rejected' = 'pending';
    const disable = paymentFirstAdminAgents.disable(context(), agentId, {
      confirmationHash: disablePreview.confirmation_hash,
      previewToken: disablePreview.preview_token,
      reason: disableReason,
      targetStatus: 'DISABLED',
    }, 1, key());
    void disable.then(
      () => { disableState = 'fulfilled'; },
      () => { disableState = 'rejected'; },
    );
    let paymentFirstBarrierError: unknown;
    try {
      await Promise.race([
        disableLockAttempted.promise,
        disable.then(
          () => Promise.reject(new Error('Disable completed before attempting the shared Agent lock')),
          (error: unknown) => Promise.reject(error),
        ),
      ]);
      expect(await observeBlockedAdvisoryLockPairs(database)).toBeGreaterThan(0);
      expect(disableState).toBe('pending');
    } catch (error) {
      paymentFirstBarrierError = error;
    } finally {
      resumePayment.resolve();
    }
    const [settled, disabled] = await Promise.all([callback, disable]);
    await disableLockAcquired.promise;
    if (paymentFirstBarrierError !== undefined) throw paymentFirstBarrierError;
    expect(settled).toMatchObject({
      changed: true,
      finalAgentId: agentId,
      finalChannel: 'AGENT',
      kind: 'SETTLED',
    });
    expect(disabled.envelope.data).toMatchObject({
      resource_id: agentId,
      status: 'DISABLED',
      version: 2,
    });
    expect(await database.prisma.orderAttributionSnapshot.findUnique({ where: { order_id: payment.orderId } }))
      .toMatchObject({ agent_id_snapshot: agentId, final_channel: 'AGENT' });
    expect(await database.prisma.agentProfile.findUnique({ where: { id: agentId } }))
      .toMatchObject({ status: 'DISABLED', version: 2 });
    expect(await database.prisma.authSession.count({
      where: { account_id: agentAccountId, revoked_at: null },
    })).toBe(0);
    await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${beforeDisableAccess}`)
      .expect(401);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const disabledLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword });
    expect(disabledLogin.status).toBe(401);
    expectNoStore(disabledLogin);
    expect({ code: disabledLogin.body.code, message: disabledLogin.body.message })
      .toEqual({ code: unknown.body.code, message: unknown.body.message });

    const reactivated = await adminAgents.reactivate(context(), agentId, 2, key());
    expect(reactivated.envelope.data).toMatchObject({
      resource_id: agentId,
      status: 'ACTIVE',
      version: 3,
    });
    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const reactivatedLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword })
      .expect(200);
    const reactivatedAccess = reactivatedLogin.body.data.access_token as string;

    const resetReason = 'B13.1 integration password reset';
    const resetPreview = await adminAgents.previewPasswordReset(context(), agentId, {
      reason: resetReason,
    }, key());
    const resetKey = key();
    const reset = await adminAgents.resetPassword(context(), agentId, {
      confirmationHash: resetPreview.confirmation_hash,
      previewToken: resetPreview.preview_token,
      reason: resetReason,
    }, 3, resetKey);
    expect(reset).toMatchObject({
      agent: { agent_id: agentId, status: 'ACTIVE', version: 4 },
      disclosure_state: 'FIRST_ISSUE',
      must_change_password: true,
      reissue_required: false,
    });
    expect(reset.temporary_password).toMatch(/^Tmp!9[A-Za-z0-9_-]+$/);
    const resetTemporaryPassword = reset.temporary_password as string;
    const resetReplay = await adminAgents.resetPassword(context(), agentId, {
      confirmationHash: resetPreview.confirmation_hash,
      previewToken: resetPreview.preview_token,
      reason: resetReason,
    }, 3, resetKey);
    expect(resetReplay).toMatchObject({
      agent: { agent_id: agentId, version: 4 },
      disclosure_state: 'REPLAY_REDACTED',
      expires_at: null,
      reissue_required: true,
      temporary_password: null,
    });
    await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', `Bearer ${reactivatedAccess}`)
      .expect(401);

    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const oldPasswordAfterReset = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: updatedPassword });
    expect(oldPasswordAfterReset.status).toBe(401);
    expectNoStore(oldPasswordAfterReset);
    await clearAgentLoginRedis(redis, config, [loginName], idempotencyKeys);
    const resetLogin = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', key())
      .send({ login_name: loginName, password: resetTemporaryPassword })
      .expect(200);
    expect(resetLogin.body.data).toMatchObject({
      must_change_password: true,
      restriction: 'CHANGE_PASSWORD_ONLY',
    });
    expect(resetLogin.body.data).not.toHaveProperty('refresh_token');

    const disabledFirstReason = 'B13.1 disable-first payment concurrency integration';
    const disabledFirstPreview = await adminAgents.previewDisable(context(), agentId, {
      reason: disabledFirstReason,
      targetStatus: 'DISABLED',
    }, key());
    expect(disabledFirstPreview.impact.metrics).toContainEqual(expect.objectContaining({
      key: 'pending_payment_orders',
      before: '1',
      after: '1',
    }));
    const disableFirstLockAcquired = deferred<void>();
    const resumeDisableFirst = deferred<void>();
    const disableFirstAdminAgents = new AdminAgentsService(
      config,
      databaseWithAgentLockBarrier(database, agentId, {
        acquired: disableFirstLockAcquired,
        release: resumeDisableFirst,
      }),
    );
    const disabledFirst = disableFirstAdminAgents.disable(context(), agentId, {
      confirmationHash: disabledFirstPreview.confirmation_hash,
      previewToken: disabledFirstPreview.preview_token,
      reason: disabledFirstReason,
      targetStatus: 'DISABLED',
    }, 4, key());
    await Promise.race([
      disableFirstLockAcquired.promise,
      disabledFirst.then(
        () => Promise.reject(new Error('Disable completed before acquiring the shared Agent lock')),
        (error: unknown) => Promise.reject(error),
      ),
    ]);
    expect(await database.prisma.agentProfile.findUnique({ where: { id: agentId } }))
      .toMatchObject({ status: 'ACTIVE', version: 4 });

    const disabledFirstPaymentLockAcquired = deferred<void>();
    const disabledFirstPaymentLockAttempted = deferred<void>();
    let disabledFirstPaymentState: 'fulfilled' | 'pending' | 'rejected' = 'pending';
    const degraded = runSerializableTransaction(database.prisma, (transaction) =>
      paymentRepository.applyPaymentCallbackInTransaction(
        transactionWithAgentLockBarrier(transaction, agentId, {
          acquired: disabledFirstPaymentLockAcquired,
          attempted: disabledFirstPaymentLockAttempted,
        }),
        {
          amount: '19.90',
          eventType: 'payment.succeeded',
          occurredAt: new Date(),
          outcome: 'SUCCEEDED',
          provider: 'MOCK',
          providerEventId: `b131-event-${disabledFirstPayment.paymentIntentId}`,
          providerIntentId: disabledFirstPayment.providerIntentId,
          providerTransactionId: `b131-transaction-${disabledFirstPayment.paymentIntentId}`,
        },
      ), transactionRetryOptions);
    void degraded.then(
      () => { disabledFirstPaymentState = 'fulfilled'; },
      () => { disabledFirstPaymentState = 'rejected'; },
    );
    let disableFirstBarrierError: unknown;
    try {
      await Promise.race([
        disabledFirstPaymentLockAttempted.promise,
        degraded.then(
          () => Promise.reject(new Error('Payment completed before attempting the shared Agent lock')),
          (error: unknown) => Promise.reject(error),
        ),
      ]);
      expect(await observeBlockedAdvisoryLockPairs(database)).toBeGreaterThan(0);
      expect(disabledFirstPaymentState).toBe('pending');
    } catch (error) {
      disableFirstBarrierError = error;
    } finally {
      resumeDisableFirst.resolve();
    }
    const [disabledFirstResult, degradedResult] = await Promise.all([disabledFirst, degraded]);
    await disabledFirstPaymentLockAcquired.promise;
    if (disableFirstBarrierError !== undefined) throw disableFirstBarrierError;
    expect(disabledFirstResult.envelope.data).toMatchObject({
      resource_id: agentId,
      status: 'DISABLED',
      version: 5,
    });
    expect(degradedResult).toMatchObject({
      changed: true,
      finalAgentId: null,
      finalChannel: 'DIRECT',
      kind: 'SETTLED',
    });
    expect(await database.prisma.salesOrder.findUnique({
      where: { id: disabledFirstPayment.orderId },
    })).toMatchObject({ final_agent_id: null, final_channel: 'DIRECT' });
    expect(await database.prisma.orderAttributionSnapshot.findUnique({
      where: { order_id: disabledFirstPayment.orderId },
    })).toMatchObject({ agent_id_snapshot: null, final_channel: 'DIRECT' });
    expect(await database.prisma.orderAttributionCandidate.findUnique({
      where: { order_id: disabledFirstPayment.orderId },
    })).toMatchObject({ finalization_result: 'DIRECT_AGENT_UNAVAILABLE' });
    expect(await Promise.all([
      database.prisma.agentCustomerPrivacyProjection.count({
        where: { attribution_snapshot: { order_id: disabledFirstPayment.orderId } },
      }),
      database.prisma.orderItemCommissionSnapshot.count({
        where: { order_item: { order_id: disabledFirstPayment.orderId } },
      }),
      database.prisma.orderItemCommissionPosition.count({
        where: { snapshot: { order_item: { order_id: disabledFirstPayment.orderId } } },
      }),
      database.prisma.commissionLedger.count({
        where: { snapshot: { is: { order_item: { order_id: disabledFirstPayment.orderId } } } },
      }),
    ])).toEqual([0, 0, 0, 0]);

    const [account, inviteCodes, idempotency, audit, outbox] = await Promise.all([
      database.prisma.account.findUniqueOrThrow({ where: { id: agentAccountId } }),
      database.prisma.agentInviteCode.findMany({ where: { agent_id: agentId } }),
      database.prisma.idempotencyRecord.findMany({
        where: { idempotency_key: { in: idempotencyKeys } },
      }),
      database.prisma.auditLog.findMany({
        where: {
          OR: [
            { actor_account_id: adminAccountId },
            { actor_account_id: agentAccountId },
            { idempotency_key: { in: idempotencyKeys } },
          ],
        },
      }),
      database.prisma.outboxEvent.findMany({ where: { aggregate_id: agentId } }),
    ]);
    expect(account.password_hash).toMatch(/^\$argon2id\$/);
    expect(inviteCodes).toHaveLength(1);
    expect(idempotency.length).toBeGreaterThan(10);
    expect(idempotency.every(({ request_hash, response_body_hash }) =>
      /^[a-f0-9]{64}$/.test(request_hash) &&
      (response_body_hash === null || /^[a-f0-9]{64}$/.test(response_body_hash)))).toBe(true);
    expect(audit.length).toBeGreaterThan(10);
    expect(outbox.map(({ event_type }) => event_type)).toEqual(expect.arrayContaining([
      'agent.created',
      'agent.disabled',
      'agent.reactivated',
      'agent.password_reset',
    ]));
    const persistedSecurityFacts = JSON.stringify({ account, audit, idempotency, inviteCodes, outbox });
    for (const sensitiveValue of [
      '13800138000',
      initialInviteCode,
      temporaryPassword,
      permanentPassword,
      updatedPassword,
      resetTemporaryPassword,
      wrongPassword,
      restrictedAccessToken,
      firstAccessToken,
      firstRefreshToken,
      postChangeAccessToken,
      postChangeRefreshToken,
      rotatedAccessToken,
      rotatedRefreshToken,
      recoveredAccessToken,
      recoveredRefreshToken,
      logoutAccessToken,
      logoutRefreshToken,
      logoutAllFirstAccess,
      logoutAllFirstRefresh,
      logoutAllSecondAccess,
      logoutAllSecondRefresh,
      reactivatedAccess,
      resetLogin.body.data.access_token,
    ]) {
      expect(persistedSecurityFacts).not.toContain(sensitiveValue);
    }
  }, 240_000);
});
