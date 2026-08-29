import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
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

  it('persists prepare/finalize facts, reuses the active intent and rolls every fixture back', async () => {
    const now = new Date();
    const accountId = generateUlid(now.getTime() - 5_000);
    const customerId = generateUlid(now.getTime() - 4_000);
    const orderId = generateUlid(now.getTime() - 3_000);
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

      const prepared = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId,
        customerId,
        expectedVersion: 1,
        orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      paymentIntentId = prepared.intent.paymentIntentId;
      expect(prepared).toMatchObject({ created: true, providerOperation: 'CREATE' });

      const reused = await repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId,
        customerId,
        expectedVersion: 1,
        orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      });
      expect(reused.intent.paymentIntentId).toBe(paymentIntentId);
      expect(reused.created).toBe(false);
      expect(reused.providerOperation).toBe('QUERY');

      const nextReconcileAt = new Date(prepared.intent.serverTime.getTime() + 60_000);
      const opened = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt,
          providerIntentId: `mock-${paymentIntentId}`,
          providerState: 'OPEN',
        },
      });
      expect(opened).toMatchObject({ changed: true, intent: { status: 'OPEN', version: 2 } });
      await expect(transaction.salesOrder.findUnique({
        select: { payment_status: true, version: true },
        where: { id: orderId },
      })).resolves.toEqual({ payment_status: 'PROCESSING', version: 2 });

      await expect(repository.prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId,
        customerId,
        expectedVersion: 1,
        orderId,
        provider: 'MOCK',
        reconcileAfterMs: 30_000,
      })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

      const replay = await repository.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: 1,
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: {
          kind: 'OPEN',
          nextReconcileAt,
          providerIntentId: `mock-${paymentIntentId}`,
          providerState: 'OPEN',
        },
      });
      expect(replay).toMatchObject({ changed: false, intent: { status: 'OPEN', version: 2 } });
      await expect(repository.getOwnedPaymentIntentInTransaction(transaction, {
        customerId,
        paymentIntentId,
      })).resolves.toMatchObject({ paymentIntentId, status: 'OPEN' });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await expect(runtime.prisma.salesOrder.count({ where: { id: orderId } })).resolves.toBe(0);
    if (paymentIntentId !== undefined) {
      await expect(runtime.prisma.paymentIntent.count({ where: { id: paymentIntentId } })).resolves.toBe(0);
    }
    await expect(runtime.prisma.account.count({ where: { id: accountId } })).resolves.toBe(0);
  }, 120_000);
});
