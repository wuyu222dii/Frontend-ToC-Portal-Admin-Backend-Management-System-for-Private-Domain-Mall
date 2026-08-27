import { randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseTransaction, IdempotencyHashKeyRing } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StorePrivacyRepository } from './store-privacy.repository';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_PRIVACY_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const hashKeys: IdempotencyHashKeyRing = {
  current: { id: 'b74-privacy-v1', key: Buffer.alloc(32, 0x74) },
  previous: [],
};

interface FixtureIds {
  accountId: string;
  addressId: string;
  agentAccountId: string;
  agentId: string;
  bindingId: string;
  candidateId: string;
  cartId: string;
  cartItemId: string;
  categoryId: string;
  changeId: string;
  customerId: string;
  deletionId: string;
  favoriteId: string;
  inviteId: string;
  orderId: string;
  productId: string;
  projectionId: string;
  promotionId: string;
  sessionIds: [string, string];
  skuId: string;
  snapshotId: string;
  phoneId: string;
  brandId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B7 Store privacy integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store privacy tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store privacy DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store privacy tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b74-store-privacy-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 6,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store privacy tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b74-store-privacy-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function ids(): FixtureIds {
  return {
    accountId: generateUlid(),
    addressId: generateUlid(),
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    bindingId: generateUlid(),
    brandId: generateUlid(),
    candidateId: generateUlid(),
    cartId: generateUlid(),
    cartItemId: generateUlid(),
    categoryId: generateUlid(),
    changeId: generateUlid(),
    customerId: generateUlid(),
    deletionId: generateUlid(),
    favoriteId: generateUlid(),
    inviteId: generateUlid(),
    orderId: generateUlid(),
    phoneId: generateUlid(),
    productId: generateUlid(),
    projectionId: generateUlid(),
    promotionId: generateUlid(),
    sessionIds: [generateUlid(), generateUlid()],
    skuId: generateUlid(),
    snapshotId: generateUlid(),
  };
}

async function createFixture(transaction: DatabaseTransaction, fixture: FixtureIds, now: Date): Promise<void> {
  const suffix = randomUUID().replaceAll('-', '');
  await transaction.account.create({
    data: {
      created_at: now,
      deleted_at: null,
      id: fixture.agentAccountId,
      login_name: `b74-agent-${suffix}`,
      must_change_password: false,
      password_hash: 'b74-agent-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: fixture.agentAccountId,
      agent_no: `B74-${suffix.slice(0, 20)}`,
      created_at: now,
      deleted_at: null,
      id: fixture.agentId,
      name: 'B7.4 Privacy Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.account.create({
    data: {
      created_at: now,
      deleted_at: null,
      id: fixture.accountId,
      last_login_at: now,
      login_name: null,
      must_change_password: false,
      password_hash: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
      wechat_open_id: `b74-open-${suffix}`,
      wechat_union_id: `b74-union-${suffix}`,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.accountId,
      avatar_url: 'https://cdn.example.invalid/avatar.png',
      city: 'Auckland',
      created_at: now,
      id: fixture.customerId,
      nickname: 'Privacy Fixture',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  for (const [index, sessionId] of fixture.sessionIds.entries()) {
    await transaction.authSession.create({
      data: {
        access_jti: `b74-access-${index}-${suffix}`,
        account_id: fixture.accountId,
        assurance: 'WECHAT',
        created_at: now,
        expires_at: new Date(now.getTime() + 3_600_000),
        id: sessionId,
        refresh_token_hash: `${index + 1}`.repeat(64),
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: generateUlid(),
      },
    });
  }
  await transaction.customerPhoneVerification.create({
    data: {
      consent_version: 'b74-phone-v1',
      created_at: now,
      customer_id: fixture.customerId,
      encryption_key_id: 'b74-field-v1',
      id: fixture.phoneId,
      phone_ciphertext: Buffer.from('encrypted-account-phone'),
      phone_hash: 'a'.repeat(64),
      phone_last4: '1234',
      source: 'MOCK',
      verified_at: now,
    },
  });
  await transaction.customerAddress.create({
    data: {
      city: 'Auckland',
      created_at: now,
      customer_id: fixture.customerId,
      deleted_at: null,
      detail_ciphertext: Buffer.from('encrypted-address'),
      district: 'Central',
      encryption_key_id: 'b74-field-v1',
      id: fixture.addressId,
      is_default: true,
      phone_ciphertext: Buffer.from('encrypted-address-phone'),
      phone_hash: 'b'.repeat(64),
      phone_last4: '5678',
      province: 'Auckland',
      recipient_name: 'Fixture Recipient',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B74 Brand ${suffix}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B74 Category ${suffix}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      created_at: now,
      id: fixture.productId,
      name: 'B7.4 Privacy Product',
      spu_code: `B74-SPU-${suffix}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B74-SKU-${suffix}`,
      created_at: now,
      id: fixture.skuId,
      name: 'B7.4 Privacy SKU',
      product_id: fixture.productId,
      retail_price: '12.34',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.favorite.create({
    data: {
      created_at: now,
      customer_id: fixture.customerId,
      id: fixture.favoriteId,
      product_id: fixture.productId,
    },
  });
  await transaction.cart.create({
    data: { created_at: now, customer_id: fixture.customerId, id: fixture.cartId, updated_at: now },
  });
  await transaction.cartItem.create({
    data: {
      cart_id: fixture.cartId,
      created_at: now,
      id: fixture.cartItemId,
      quantity: 2,
      selected: true,
      sku_id: fixture.skuId,
      updated_at: now,
    },
  });
  await transaction.agentInviteCode.create({
    data: {
      agent_id: fixture.agentId,
      code_ciphertext: Buffer.from('b74-invite'),
      code_hash: 'c'.repeat(64),
      code_last4: 'B074',
      created_at: now,
      effective_at: now,
      encryption_key_id: 'b74-field-v1',
      id: fixture.inviteId,
      status: 'ACTIVE',
    },
  });
  await transaction.promotionAsset.create({
    data: {
      agent_id: fixture.agentId,
      authorization_version: 1,
      created_at: now,
      id: fixture.promotionId,
      invite_code_id: fixture.inviteId,
      public_url: 'https://store.example.invalid/',
      status: 'ACTIVE',
      target_type: 'STOREFRONT',
    },
  });
  await transaction.attributionCandidate.create({
    data: {
      agent_id: fixture.agentId,
      candidate_token_hash: null,
      created_at: now,
      customer_id: fixture.customerId,
      expires_at: new Date(now.getTime() + 1_800_000),
      id: fixture.candidateId,
      invite_code_id: fixture.inviteId,
      promotion_asset_id: fixture.promotionId,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.customerAgentBinding.create({
    data: {
      agent_id: fixture.agentId,
      created_at: now,
      customer_id: fixture.customerId,
      id: fixture.bindingId,
      started_at: now,
    },
  });
  await transaction.salesOrder.create({
    data: {
      close_reason: 'USER_CANCELLED',
      closed_at: now,
      created_at: now,
      customer_id: fixture.customerId,
      fulfillment_status: 'CANCELLED',
      goods_amount: '0.00',
      id: fixture.orderId,
      order_no: `B74${suffix.slice(0, 20)}`,
      order_status: 'CLOSED',
      paid_amount: '0.00',
      pay_expires_at: new Date(now.getTime() + 30 * 60_000),
      payable_amount: '0.00',
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
  await transaction.orderAttributionSnapshot.create({
    data: {
      agent_id_snapshot: fixture.agentId,
      binding_id_snapshot: fixture.bindingId,
      captured_at: now,
      final_channel: 'AGENT',
      id: fixture.snapshotId,
      order_id: fixture.orderId,
    },
  });
  await transaction.agentCustomerPrivacyProjection.create({
    data: {
      agent_id: fixture.agentId,
      attribution_snapshot_id: fixture.snapshotId,
      city: 'Auckland',
      created_at: now,
      customer_alias: 'Customer Fixture',
      customer_id: fixture.customerId,
      id: fixture.projectionId,
      nickname_masked: 'P***e',
      phone_tail: '1234',
      updated_at: now,
    },
  });
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, fixture: FixtureIds): Promise<void> {
  const counts = await Promise.all([
    runtime.prisma.account.count({ where: { id: { in: [fixture.accountId, fixture.agentAccountId] } } }),
    runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
    runtime.prisma.accountDeletionRequest.count({ where: { id: fixture.deletionId } }),
    runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
    runtime.prisma.bindingChangeLog.count({ where: { id: fixture.changeId } }),
    runtime.prisma.product.count({ where: { id: fixture.productId } }),
  ]);
  expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
}

integrationDescribe('B7.4 Store privacy repository PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('atomically anonymizes the account, revokes sessions and removes non-transactional PII', async () => {
    const fixture = ids();
    const now = new Date();
    const token = `del_${randomUUID()}_${randomUUID()}`;
    const alias = `deleted_${generateUlid().toLowerCase()}`;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await createFixture(transaction, fixture, now);
      const repository = new StorePrivacyRepository(runtime.prisma, hashKeys, () => now);
      const preview = await repository.previewDeletionInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        previewToken: token,
        request: { acknowledged: true },
        sessionId: fixture.sessionIds[0],
      });
      expect(preview).toMatchObject({ accountVersion: 1, blockers: [], preview: { expiresAt: expect.any(Date) } });
      const completed = await repository.confirmDeletionInTransaction(transaction, {
        accountId: fixture.accountId,
        anonymousAlias: alias,
        bindingChangeLogId: fixture.changeId,
        confirmationHash: preview.preview!.confirmationHash,
        customerId: fixture.customerId,
        deletionRequestId: fixture.deletionId,
        expectedAccountVersion: 1,
        previewToken: token,
        request: { acknowledged: true },
        sessionId: fixture.sessionIds[0],
      });
      expect(completed).toEqual({
        accountVersion: 2,
        completedAt: now,
        requestId: fixture.deletionId,
        status: 'COMPLETED',
        submittedAt: now,
      });
      expect(await transaction.account.findUnique({ where: { id: fixture.accountId } })).toMatchObject({
        deleted_at: now,
        login_name: null,
        password_hash: null,
        status: 'ANONYMIZED',
        version: 2,
        wechat_open_id: null,
        wechat_union_id: null,
      });
      expect(await transaction.customerProfile.findUnique({ where: { id: fixture.customerId } })).toMatchObject({
        anonymized_at: now,
        avatar_url: null,
        city: null,
        nickname: null,
        version: 2,
      });
      expect(await transaction.authSession.findMany({
        where: { id: { in: fixture.sessionIds } },
        orderBy: { id: 'asc' },
      })).toSatisfy((sessions: Array<{
        assurance: string;
        mfa_factor_id: string | null;
        mfa_verified_at: Date | null;
        refresh_token_hash: string | null;
        restriction: string;
        revoked_at: Date | null;
      }>) =>
        sessions.length === 2 && sessions.every((session) =>
          session.assurance === 'PASSWORD' && session.mfa_factor_id === null &&
          session.mfa_verified_at === null && session.refresh_token_hash === null &&
          session.restriction === 'CHANGE_PASSWORD_ONLY' && session.revoked_at?.getTime() === now.getTime()));
      expect(await Promise.all([
        transaction.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
        transaction.customerAddress.count({ where: { customer_id: fixture.customerId } }),
        transaction.favorite.count({ where: { customer_id: fixture.customerId } }),
        transaction.cartItem.count({ where: { cart_id: fixture.cartId } }),
      ])).toEqual([0, 0, 0, 0]);
      expect(await transaction.cart.count({ where: { id: fixture.cartId } })).toBe(1);
      expect(await transaction.attributionCandidate.findUnique({ where: { id: fixture.candidateId } })).toMatchObject({
        candidate_token_hash: null,
        invalid_reason: 'ACCOUNT_DELETED',
        status: 'INVALIDATED',
      });
      expect(await transaction.customerAgentBinding.findUnique({ where: { id: fixture.bindingId } })).toMatchObject({
        ended_at: now,
        end_reason: 'ACCOUNT_DELETED',
      });
      expect(await transaction.bindingChangeLog.findUnique({ where: { id: fixture.changeId } })).toMatchObject({
        actor_account_id: fixture.accountId,
        old_binding_id: fixture.bindingId,
        reason: 'ACCOUNT_DELETED',
      });
      expect(await transaction.agentCustomerPrivacyProjection.findUnique({
        where: { id: fixture.projectionId },
      })).toMatchObject({
        anonymized_at: now,
        city: null,
        customer_alias: alias,
        nickname_masked: null,
        phone_tail: null,
      });
      expect(await transaction.accountDeletionRequest.findUnique({ where: { id: fixture.deletionId } })).toMatchObject({
        completed_at: now,
        processing_at: now,
        status: 'COMPLETED',
        submitted_at: now,
      });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, fixture);
  }, 90_000);

  it('rolls preview consumption and every deletion mutation back when a new blocker appears', async () => {
    const fixture = ids();
    const now = new Date();
    const token = `del_${randomUUID()}_${randomUUID()}`;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await createFixture(transaction, fixture, now);
      const repository = new StorePrivacyRepository(runtime.prisma, hashKeys, () => now);
      const preview = await repository.previewDeletionInTransaction(transaction, {
        accountId: fixture.accountId,
        customerId: fixture.customerId,
        previewToken: token,
        request: { acknowledged: true },
        sessionId: fixture.sessionIds[0],
      });
      await transaction.salesOrder.update({
        where: { id: fixture.orderId },
        data: {
          close_reason: null,
          closed_at: null,
          fulfillment_status: 'NOT_STARTED',
          order_status: 'PENDING_PAYMENT',
          updated_at: now,
          version: { increment: 1 },
        },
      });
      return repository.confirmDeletionInTransaction(transaction, {
        accountId: fixture.accountId,
        anonymousAlias: `deleted_${generateUlid().toLowerCase()}`,
        bindingChangeLogId: fixture.changeId,
        confirmationHash: preview.preview!.confirmationHash,
        customerId: fixture.customerId,
        deletionRequestId: fixture.deletionId,
        expectedAccountVersion: 1,
        previewToken: token,
        request: { acknowledged: true },
        sessionId: fixture.sessionIds[0],
      });
    }, transactionOptions)).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_BLOCKED' });
    await assertNoFixtureFacts(runtime, fixture);
  }, 90_000);

  it.each(['REFUNDING', 'FAILED'] as const)(
    'fails closed for aggregate refund state %s without an unsettled refund fact',
    async (refundProcessingStatus) => {
      const fixture = ids();
      const now = new Date();
      await expect(runtime.withPrismaTransaction(async (transaction) => {
        await createFixture(transaction, fixture, now);
        await transaction.salesOrder.update({
          where: { id: fixture.orderId },
          data: {
            refund_processing_status: refundProcessingStatus,
            updated_at: now,
            version: { increment: 1 },
          },
        });
        const repository = new StorePrivacyRepository(runtime.prisma, hashKeys, () => now);
        const preview = await repository.previewDeletionInTransaction(transaction, {
          accountId: fixture.accountId,
          customerId: fixture.customerId,
          previewToken: `del_${randomUUID()}_${randomUUID()}`,
          request: { acknowledged: true },
          sessionId: fixture.sessionIds[0],
        });
        expect(preview).toEqual({
          accountVersion: 1,
          blockers: [{ count: 1, resourceType: 'FINANCIAL_ANOMALY' }],
          preview: null,
        });
        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);
      await assertNoFixtureFacts(runtime, fixture);
    },
    90_000,
  );
});
