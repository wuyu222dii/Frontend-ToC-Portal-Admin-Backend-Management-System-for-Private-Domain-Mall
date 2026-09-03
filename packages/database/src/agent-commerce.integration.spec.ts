import { randomUUID } from 'node:crypto';

import { generateStoreCandidateToken, generateUlid, hmacStoreCandidateToken } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { AgentCommerceRepository } from './agent-commerce.repository';
import { FileAssetRepository } from './file-asset.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StoreAttributionRepository } from './store-attribution.repository';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B132_AGENT_COMMERCE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B132_AGENT_COMMERCE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const rollbackSentinel = Object.freeze({ code: 'B132_AGENT_COMMERCE_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  accountIds: [string, string, string];
  agentId: string;
  bindingId: string;
  brandId: string;
  candidateIds: [string, string, string, string];
  categoryId: string;
  commissionLedgerId: string;
  commissionPositionId: string;
  commissionRuleId: string;
  commissionSnapshotId: string;
  customerId: string;
  inviteId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  promotionAssetId: string;
  qrFileId: string;
  skuId: string;
  whitelistId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B13.2 Agent commerce integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.2 Agent commerce tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B13.2 Agent commerce DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.2 Agent commerce tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b132-agent-commerce-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.2 Agent commerce tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b132-agent-commerce-rollback',
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
  const ids = Array.from({ length: 22 }, () => generateUlid());
  return {
    accountIds: [ids[0]!, ids[1]!, ids[2]!],
    agentId: ids[3]!,
    bindingId: ids[4]!,
    brandId: ids[5]!,
    candidateIds: [ids[6]!, ids[7]!, ids[8]!, ids[9]!],
    categoryId: ids[10]!,
    commissionLedgerId: ids[11]!,
    commissionPositionId: ids[12]!,
    commissionRuleId: ids[13]!,
    commissionSnapshotId: ids[14]!,
    customerId: ids[15]!,
    inviteId: ids[16]!,
    orderId: ids[17]!,
    orderItemId: ids[18]!,
    productId: ids[19]!,
    promotionAssetId: ids[20]!,
    qrFileId: ids[21]!,
    skuId: generateUlid(),
    whitelistId: generateUlid(),
  };
}

async function createFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  now: Date,
  inviteHash: string,
): Promise<void> {
  const suffix = randomUUID();
  await transaction.account.createMany({
    data: [
      {
        created_at: now,
        id: ids.accountIds[0],
        login_name: `b132-agent-${suffix}`,
        must_change_password: false,
        password_hash: 'b132-fixture-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: ids.accountIds[1],
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
        wechat_open_id: `b132-customer-${suffix}`,
      },
      {
        created_at: now,
        id: ids.accountIds[2],
        login_name: `b132-admin-${suffix}`,
        must_change_password: false,
        password_hash: 'b132-fixture-password-hash',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.accountIds[0],
      agent_no: `B132-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B13.2 Fixture Agent',
      product_authorization_mode: 'CUSTOM_WHITELIST',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.accountIds[1],
      created_at: now,
      id: ids.customerId,
      nickname: 'B13.2 Fixture Customer',
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.customerAgentBinding.create({
    data: {
      agent_id: ids.agentId,
      created_at: new Date(now.getTime() - 7_200_000),
      customer_id: ids.customerId,
      ended_at: new Date(now.getTime() - 3_600_000),
      end_reason: 'TRANSFERRED',
      id: ids.bindingId,
      started_at: new Date(now.getTime() - 7_200_000),
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: ids.brandId,
      name: `B13.2 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: ids.categoryId,
      name: `B13.2 Category ${ids.categoryId}`,
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
      name: 'B13.2 Fixture Product',
      published_at: now,
      spu_code: `B132-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B132-SKU-${ids.skuId}`,
      created_at: now,
      id: ids.skuId,
      name: 'B13.2 Fixture SKU',
      product_id: ids.productId,
      retail_price: '10.00',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProductWhitelist.create({
    data: {
      agent_id: ids.agentId,
      created_at: now,
      id: ids.whitelistId,
      product_id: ids.productId,
    },
  });
  await transaction.agentInviteCode.create({
    data: {
      agent_id: ids.agentId,
      code_ciphertext: Buffer.from('b132-fixture-invite-ciphertext'),
      code_hash: inviteHash,
      code_last4: 'B132',
      created_at: now,
      effective_at: new Date(now.getTime() - 60_000),
      encryption_key_id: 'b132-fixture-field-v1',
      expires_at: new Date(now.getTime() + 3_600_000),
      id: ids.inviteId,
      status: 'ACTIVE',
    },
  });

  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: ids.customerId,
      final_agent_id: ids.agentId,
      final_channel: 'AGENT',
      goods_amount: '10.00',
      id: ids.orderId,
      order_no: `B132${ids.orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: '10.00',
      paid_at: now,
      pay_expires_at: new Date(now.getTime() + 30 * 60_000),
      payable_amount: '10.00',
      payment_status: 'PAID',
      shipping_amount: '0.00',
      source: 'BUY_NOW',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      brand_name_snapshot: 'B13.2 Fixture Brand',
      category_id: ids.categoryId,
      category_name_snapshot: 'B13.2 Fixture Category',
      created_at: now,
      id: ids.orderItemId,
      line_paid_amount: '10.00',
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: 'B13.2 Fixture Product',
      quantity: 1,
      sku_code_snapshot: `B132-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B13.2 Fixture SKU',
      unit_price: '10.00',
      version: 1,
    },
  });
  const latestRule = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
  await transaction.commissionRuleVersion.create({
    data: {
      created_at: now,
      created_by_id: ids.accountIds[2],
      id: ids.commissionRuleId,
      reason: 'B13.2 immutable commission fixture',
      status: 'DRAFT',
      version_no: (latestRule._max.version_no ?? 0) + 1,
    },
  });
  await transaction.orderItemCommissionSnapshot.create({
    data: {
      agent_id: ids.agentId,
      category_id_snapshot: ids.categoryId,
      category_name_snapshot: 'B13.2 Fixture Category',
      commission_base: '10.00',
      created_at: now,
      effective_rate: '10.0000',
      id: ids.commissionSnapshotId,
      order_item_id: ids.orderItemId,
      original_commission: '1.00',
      product_id_snapshot: ids.productId,
      rule_version_id: ids.commissionRuleId,
      sku_id_snapshot: ids.skuId,
      source_type: 'PLATFORM',
    },
  });
  await transaction.orderItemCommissionPosition.create({
    data: {
      expected_remaining: '1.00',
      id: ids.commissionPositionId,
      original_commission: '1.00',
      reversed_total: '0.00',
      snapshot_id: ids.commissionSnapshotId,
      state: 'EXPECTED',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.commissionLedger.create({
    data: {
      agent_id: ids.agentId,
      available_change: '0.00',
      expected_change: '1.00',
      frozen_change: '0.00',
      id: ids.commissionLedgerId,
      idempotency_key: `b132:${ids.commissionSnapshotId}`,
      ledger_type: 'EXPECTED_CREATED',
      occurred_at: now,
      reason: 'B13.2_HISTORICAL_COMMISSION',
      snapshot_id: ids.commissionSnapshotId,
    },
  });
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, ids: FixtureIds): Promise<void> {
  const counts = await Promise.all([
    runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } }),
    runtime.prisma.agentProfile.count({ where: { id: ids.agentId } }),
    runtime.prisma.customerProfile.count({ where: { id: ids.customerId } }),
    runtime.prisma.customerAgentBinding.count({ where: { id: ids.bindingId } }),
    runtime.prisma.brand.count({ where: { id: ids.brandId } }),
    runtime.prisma.category.count({ where: { id: ids.categoryId } }),
    runtime.prisma.product.count({ where: { id: ids.productId } }),
    runtime.prisma.sku.count({ where: { id: ids.skuId } }),
    runtime.prisma.agentProductWhitelist.count({ where: { id: ids.whitelistId } }),
    runtime.prisma.agentInviteCode.count({ where: { id: ids.inviteId } }),
    runtime.prisma.fileAsset.count({ where: { id: ids.qrFileId } }),
    runtime.prisma.promotionAsset.count({ where: { id: ids.promotionAssetId } }),
    runtime.prisma.attributionCandidate.count({ where: { id: { in: ids.candidateIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: ids.orderId } }),
    runtime.prisma.orderItem.count({ where: { id: ids.orderItemId } }),
    runtime.prisma.commissionRuleVersion.count({ where: { id: ids.commissionRuleId } }),
    runtime.prisma.orderItemCommissionSnapshot.count({ where: { id: ids.commissionSnapshotId } }),
    runtime.prisma.orderItemCommissionPosition.count({ where: { id: ids.commissionPositionId } }),
    runtime.prisma.commissionLedger.count({ where: { id: ids.commissionLedgerId } }),
  ]);
  expect(counts).toEqual(Array.from({ length: counts.length }, () => 0));
}

databaseDescribe('B13.2 Agent commerce PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('atomically creates product promotion facts and safely degrades stale links without rewriting history',
    async () => {
      const ids = newFixtureIds();
      const now = new Date();
      const inviteHash = '1'.repeat(64);
      const candidateHashes = ids.candidateIds.map((_, index) =>
        hmacStoreCandidateToken(generateStoreCandidateToken(), Buffer.alloc(32, 40 + index)));
      const publicUrl = `https://store.example.invalid/products/${ids.productId}`;

      try {
        await expect(runtime.withPrismaTransaction(async (transaction) => {
          await createFixture(transaction, ids, now, inviteHash);
          const prisma = transactionBoundPrisma(transaction);
          const commerce = new AgentCommerceRepository(prisma, () => now);
          const files = new FileAssetRepository(prisma, () => now);
          const attribution = new StoreAttributionRepository(prisma, () => now);
          const identity = { accountId: ids.accountIds[0], agentId: ids.agentId };
          const target = {
            inviteCodeHashCandidates: [inviteHash],
            promotionAssetId: ids.promotionAssetId,
          };

          const context = await commerce.getPromotionCreationContext({
            ...identity,
            targetProductId: ids.productId,
            targetType: 'PRODUCT',
          });
          expect(context).toMatchObject({ authorizationVersion: 1, inviteCode: { id: ids.inviteId } });
          await files.createPendingInTransaction(transaction, {
            actorId: identity.accountId,
            byteSize: 128n,
            id: ids.qrFileId,
            mimeType: 'image/png',
            originalName: 'promotion-qr.png',
            purpose: 'PROMOTION_QR',
            sha256: 'a'.repeat(64),
          });
          await expect(transaction.fileAsset.findUnique({ where: { id: ids.qrFileId } }))
            .resolves.toMatchObject({ status: 'PENDING', visibility: 'PRIVATE' });
          await expect(transaction.promotionAsset.findUnique({ where: { id: ids.promotionAssetId } }))
            .resolves.toBeNull();
          const created = await commerce.createPromotionAssetInTransaction(transaction, {
            ...identity,
            inviteCodeId: context.inviteCode.id,
            promotionAssetId: ids.promotionAssetId,
            publicUrl,
            qrFile: { byteSize: 128n, fileId: ids.qrFileId, sha256: 'a'.repeat(64) },
            targetProductId: ids.productId,
            targetType: 'PRODUCT',
          });
          expect(created).toMatchObject({
            id: ids.promotionAssetId,
            inviteCodeId: ids.inviteId,
            qrFile: {
              id: ids.qrFileId,
              objectKey: `private/${ids.qrFileId}`,
              purpose: 'PROMOTION_QR',
              status: 'READY',
              visibility: 'PRIVATE',
            },
            targetProductId: ids.productId,
          });
          await expect(transaction.promotionAsset.findUniqueOrThrow({
            include: { qr_file: true },
            where: { id: ids.promotionAssetId },
          })).resolves.toMatchObject({
            agent_id: ids.agentId,
            qr_file_id: ids.qrFileId,
            qr_file: {
              deleted_at: null,
              object_key: `private/${ids.qrFileId}`,
              purpose: 'PROMOTION_QR',
              status: 'READY',
              visibility: 'PRIVATE',
            },
            status: 'ACTIVE',
          });

          await expect(attribution.createAnonymousCandidateInTransaction(transaction, {
            ...target,
            candidateId: ids.candidateIds[0],
            candidateTokenHash: candidateHashes[0]!,
          })).resolves.toMatchObject({ kind: 'candidate', candidate: { id: ids.candidateIds[0] } });

          const historyBefore = await Promise.all([
            transaction.customerAgentBinding.findUniqueOrThrow({ where: { id: ids.bindingId } }),
            transaction.orderItemCommissionSnapshot.findUniqueOrThrow({ where: { id: ids.commissionSnapshotId } }),
            transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.commissionPositionId } }),
            transaction.commissionLedger.findUniqueOrThrow({ where: { id: ids.commissionLedgerId } }),
          ]);
          const expectFallback = async (candidateIndex: 1 | 2 | 3): Promise<void> => {
            await expect(attribution.getAnonymousCandidate([candidateHashes[0]!])).resolves.toBeNull();
            await expect(attribution.createAnonymousCandidateInTransaction(transaction, {
              ...target,
              candidateId: ids.candidateIds[candidateIndex],
              candidateTokenHash: candidateHashes[candidateIndex]!,
            })).resolves.toEqual({ kind: 'public_fallback', publicTargetUrl: publicUrl });
            await expect(transaction.attributionCandidate.count({
              where: { id: ids.candidateIds[candidateIndex] },
            })).resolves.toBe(0);
          };

          await transaction.agentProductWhitelist.update({
            data: { deleted_at: now },
            where: { id: ids.whitelistId },
          });
          await transaction.agentProfile.update({
            data: { updated_at: now, version: { increment: 1 } },
            where: { id: ids.agentId },
          });
          await expectFallback(1);
          await transaction.agentProductWhitelist.update({
            data: { deleted_at: null },
            where: { id: ids.whitelistId },
          });

          await transaction.product.update({
            data: { status: 'INACTIVE', updated_at: now, version: { increment: 1 } },
            where: { id: ids.productId },
          });
          await expectFallback(2);
          await transaction.product.update({
            data: { status: 'ACTIVE', updated_at: now, version: { increment: 1 } },
            where: { id: ids.productId },
          });

          await transaction.agentInviteCode.update({
            data: { end_reason: 'ADMIN_DISABLED', ended_at: now, status: 'DISABLED' },
            where: { id: ids.inviteId },
          });
          await expectFallback(3);

          expect(await Promise.all([
            transaction.customerAgentBinding.findUniqueOrThrow({ where: { id: ids.bindingId } }),
            transaction.orderItemCommissionSnapshot.findUniqueOrThrow({ where: { id: ids.commissionSnapshotId } }),
            transaction.orderItemCommissionPosition.findUniqueOrThrow({ where: { id: ids.commissionPositionId } }),
            transaction.commissionLedger.findUniqueOrThrow({ where: { id: ids.commissionLedgerId } }),
          ])).toEqual(historyBefore);
          await expect(transaction.attributionCandidate.findUniqueOrThrow({
            where: { id: ids.candidateIds[0] },
          })).resolves.toMatchObject({ status: 'ACTIVE' });

          throw rollbackSentinel;
        }, transactionOptions)).rejects.toBe(rollbackSentinel);
      } finally {
        await assertNoFixtureFacts(runtime, ids);
      }
    }, 90_000);
});
