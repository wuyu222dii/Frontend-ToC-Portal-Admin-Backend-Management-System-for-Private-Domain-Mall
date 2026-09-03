import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { buildFinalObjectKey, buildStagingObjectKey } from './file-asset.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { AgentCommerceRepository } from './agent-commerce.repository';

const NOW = new Date('2026-09-03T02:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 12_000);
const agentId = generateUlid(NOW.getTime() - 11_000);
const otherAccountId = generateUlid(NOW.getTime() - 10_000);
const brandId = generateUlid(NOW.getTime() - 9_000);
const categoryId = generateUlid(NOW.getTime() - 8_000);
const productId = generateUlid(NOW.getTime() - 7_000);
const skuId = generateUlid(NOW.getTime() - 6_000);
const secondSkuId = generateUlid(NOW.getTime() - 5_000);
const inviteCodeId = generateUlid(NOW.getTime() - 4_000);
const promotionAssetId = generateUlid(NOW.getTime() - 3_000);
const qrFileId = generateUlid(NOW.getTime() - 2_000);
const ruleVersionId = generateUlid(NOW.getTime() - 1_000);
const qrSha256 = 'a'.repeat(64);
const inviteCiphertext = Buffer.from('encrypted-invite-code');
const inviteExpiresAt = new Date(NOW.getTime() + 86_400_000);

function agentRecord(overrides: Record<string, unknown> = {}) {
  return {
    account: { deleted_at: null, id: accountId, role: 'AGENT_ADMIN', status: 'ACTIVE' },
    account_id: accountId,
    deleted_at: null,
    id: agentId,
    product_authorization_mode: 'CUSTOM_WHITELIST',
    status: 'ACTIVE',
    version: 7,
    ...overrides,
  };
}

function publicFile(id: string, purpose: string) {
  return {
    deleted_at: null,
    id,
    object_key: `public/${id}`,
    purpose,
    status: 'READY',
    visibility: 'PUBLIC',
  };
}

function productRecord() {
  const logoId = generateUlid(NOW.getTime() - 20_000);
  const iconId = generateUlid(NOW.getTime() - 19_000);
  const imageId = generateUlid(NOW.getTime() - 18_000);
  return {
    brand: {
      deleted_at: null,
      description: 'Brand description',
      id: brandId,
      logo: publicFile(logoId, 'BRAND_LOGO'),
      name: 'Brand One',
      sort_order: 1,
      status: 'ACTIVE',
    },
    category: {
      deleted_at: null,
      icon: publicFile(iconId, 'CATEGORY_ICON'),
      id: categoryId,
      name: 'Category One',
      sort_order: 2,
      status: 'ACTIVE',
    },
    deleted_at: null,
    id: productId,
    images: [{
      deleted_at: null,
      file: publicFile(imageId, 'PRODUCT_IMAGE'),
      file_id: imageId,
      id: imageId,
      sort_order: 0,
    }],
    name: 'Agent Product',
    published_at: new Date(NOW.getTime() - 86_400_000),
    skus: [
      {
        code: 'SKU-ZERO',
        deleted_at: null,
        id: skuId,
        is_recommended: true,
        name: 'Zero commission SKU',
        retail_price: new Prisma.Decimal('19.99'),
        spec_json: { size: '500ml' },
        status: 'ACTIVE',
      },
      {
        code: 'SKU-CATEGORY',
        deleted_at: null,
        id: secondSkuId,
        is_recommended: false,
        name: 'Category commission SKU',
        retail_price: new Prisma.Decimal('19.99'),
        spec_json: null,
        status: 'ACTIVE',
      },
    ],
    spu_code: 'SPU-AGENT-001',
    status: 'ACTIVE',
    subtitle: 'Subtitle',
  };
}

function ruleRecord() {
  return {
    base_version_id: null,
    created_at: new Date(NOW.getTime() - 60_000),
    created_by_id: accountId,
    effective_at: new Date(NOW.getTime() - 30_000),
    entries: [
      {
        configured_rate: new Prisma.Decimal('5.0000'),
        created_at: new Date(NOW.getTime() - 30_000),
        id: generateUlid(NOW.getTime() - 17_000),
        rule_version_id: ruleVersionId,
        target_id: null,
        target_key: 'PLATFORM',
        target_type: 'PLATFORM',
      },
      {
        configured_rate: new Prisma.Decimal('7.5000'),
        created_at: new Date(NOW.getTime() - 30_000),
        id: generateUlid(NOW.getTime() - 16_000),
        rule_version_id: ruleVersionId,
        target_id: categoryId,
        target_key: `CATEGORY:${categoryId}`,
        target_type: 'CATEGORY',
      },
      {
        configured_rate: new Prisma.Decimal('0.0000'),
        created_at: new Date(NOW.getTime() - 30_000),
        id: generateUlid(NOW.getTime() - 15_000),
        rule_version_id: ruleVersionId,
        target_id: skuId,
        target_key: `SKU:${skuId}`,
        target_type: 'SKU',
      },
    ],
    id: ruleVersionId,
    reason: 'Current rule',
    status: 'PUBLISHED',
    version_no: 3,
  };
}

function inviteRecord(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: agentId,
    code_ciphertext: inviteCiphertext,
    effective_at: new Date(NOW.getTime() - 60_000),
    encryption_key_id: 'field-key-2026-09',
    ended_at: null,
    expires_at: inviteExpiresAt,
    id: inviteCodeId,
    status: 'ACTIVE',
    ...overrides,
  };
}

function repository(prisma: PrismaClient): AgentCommerceRepository {
  return new AgentCommerceRepository(prisma, () => NOW);
}

describe('AgentCommerceRepository', () => {
  it('applies active authorization before count/pagination and keeps an explicit 0% above inherited rates', async () => {
    const product = productRecord();
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => agentRecord()) },
      commissionRuleVersion: { findMany: vi.fn(async () => [ruleRecord()]) },
      product: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [product]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
        work(transaction as unknown as DatabaseTransaction)),
    };

    const result = await repository(prisma as unknown as PrismaClient).listAuthorizedProducts({
      accountId,
      agentId,
      page: 2,
      pageSize: 20,
      recommended: true,
    });

    const expectedScope = expect.objectContaining({
      brand: { is: { deleted_at: null, status: 'ACTIVE' } },
      category: { is: { deleted_at: null, status: 'ACTIVE' } },
      deleted_at: null,
      status: 'ACTIVE',
      whitelist_entries: { some: { agent_id: agentId, deleted_at: null } },
    });
    expect(transaction.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      where: expectedScope,
    }));
    expect(transaction.product.count).toHaveBeenCalledWith({ where: expectedScope });
    expect(result.total).toBe(1);
    expect(result.items[0]?.skus).toEqual([
      expect.objectContaining({
        currentEstimatedRate: '0.0000',
        estimatedCommissionPerUnit: '0.00',
        ruleSource: 'SKU',
      }),
      expect.objectContaining({
        currentEstimatedRate: '7.5000',
        estimatedCommissionPerUnit: '1.50',
        ruleSource: 'CATEGORY',
      }),
    ]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });

  it('hides a mismatched account/Agent pair before querying products', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => agentRecord({ account_id: otherAccountId })) },
      commissionRuleVersion: { findMany: vi.fn() },
      product: { count: vi.fn(), findMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
        work(transaction as unknown as DatabaseTransaction)),
    };

    await expect(repository(prisma as unknown as PrismaClient).listAuthorizedProducts({
      accountId,
      agentId,
      page: 1,
      pageSize: 20,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(transaction.product.findMany).not.toHaveBeenCalled();
    expect(transaction.commissionRuleVersion.findMany).not.toHaveBeenCalled();
  });

  it('transitions a precreated private QR from PENDING to READY before atomically binding the promotion', async () => {
    const events: string[] = [];
    let file: Record<string, unknown> = {
      byte_size: 1_024n,
      created_at: NOW,
      created_by_id: accountId,
      deleted_at: null,
      id: qrFileId,
      mime_type: 'image/png',
      object_key: buildStagingObjectKey(qrFileId),
      original_name: 'promotion-qr.png',
      purpose: 'PROMOTION_QR',
      sha256: qrSha256,
      status: 'PENDING',
      visibility: 'PRIVATE',
    };
    const fileAsset = {
      findFirst: vi.fn(async () => file),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('file:READY');
        file = { ...file, ...data };
        return file;
      }),
    };
    const promotionAsset = {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('promotion:bound');
        return data;
      }),
    };
    const transaction = {
      $queryRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(' ') ?? '';
        if (sql.includes('agent_profile')) return [{ id: agentId }];
        if (sql.includes('account')) return [{ id: accountId }];
        if (sql.includes('agent_invite_code')) return [{ id: inviteCodeId }];
        if (sql.includes('product')) return [{ id: productId }];
        return [];
      }),
      $queryRawUnsafe: vi.fn(async (_sql: string, namespace: string) => {
        events.push(`lock:${namespace}`);
        return [{ acquired: 1 }];
      }),
      agentInviteCode: { findMany: vi.fn(async () => [inviteRecord()]) },
      agentProfile: { findUnique: vi.fn(async () => agentRecord()) },
      fileAsset,
      product: { findFirst: vi.fn(async () => ({ id: productId })) },
      promotionAsset,
    };

    const result = await repository({} as PrismaClient).createPromotionAssetInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        accountId,
        agentId,
        inviteCodeId,
        promotionAssetId,
        publicUrl: `https://store.example.test/products/${productId}`,
        qrFile: { byteSize: 1_024n, fileId: qrFileId, sha256: qrSha256 },
        targetProductId: productId,
        targetType: 'PRODUCT',
      },
    );

    expect(transaction.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'store-attribution-agent',
      'agent-auth-account',
      'store-attribution-invite',
      'store-attribution-promotion',
      'store-attribution-product',
      'file-asset',
    ]);
    expect(events.indexOf('file:READY')).toBeLessThan(events.indexOf('promotion:bound'));
    expect(fileAsset.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        object_key: buildFinalObjectKey(qrFileId, 'PROMOTION_QR'),
        status: 'READY',
        visibility: 'PRIVATE',
      }),
      where: { id: qrFileId },
    });
    expect(promotionAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agent_id: agentId,
      authorization_version: 7,
      invite_code_id: inviteCodeId,
      qr_file_id: qrFileId,
      target_product_id: productId,
    }) });
    expect(result).toMatchObject({
      agentId,
      attributionEligible: true,
      inviteCode: { encryptionKeyId: 'field-key-2026-09', id: inviteCodeId },
      qrFile: { objectKey: `private/${qrFileId}`, purpose: 'PROMOTION_QR', status: 'READY' },
    });
    expect(Buffer.from(result.inviteCode.ciphertext)).toEqual(inviteCiphertext);
  });

  it('rebuilds a creation snapshot from its historical invite while keeping cross-Agent reads opaque', async () => {
    const readyFile = {
      byte_size: 1_024n,
      created_at: NOW,
      created_by_id: accountId,
      deleted_at: null,
      id: qrFileId,
      mime_type: 'image/png',
      object_key: `private/${qrFileId}`,
      original_name: 'promotion-qr.png',
      purpose: 'PROMOTION_QR',
      sha256: qrSha256,
      status: 'READY',
      visibility: 'PRIVATE',
    };
    const historicalAsset = {
      agent_id: agentId,
      authorization_version: 7,
      created_at: NOW,
      expires_at: inviteExpiresAt,
      id: promotionAssetId,
      invite_code: inviteRecord({ ended_at: NOW, status: 'ROTATED' }),
      invite_code_id: inviteCodeId,
      public_url: `https://store.example.test/products/${productId}`,
      qr_file: readyFile,
      qr_file_id: qrFileId,
      revoked_at: null,
      status: 'ACTIVE',
      target_product_id: productId,
      target_type: 'PRODUCT',
    };
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => agentRecord()) },
      promotionAsset: { findFirst: vi.fn(async () => historicalAsset) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
        work(transaction as unknown as DatabaseTransaction)),
    };
    const commerce = repository(prisma as unknown as PrismaClient);

    const snapshot = await commerce.getPromotionAsset({ accountId, agentId, promotionAssetId });
    expect(snapshot).toMatchObject({
      id: promotionAssetId,
      inviteCode: { encryptionKeyId: 'field-key-2026-09', id: inviteCodeId },
      publicUrl: `https://store.example.test/products/${productId}`,
    });
    expect(Buffer.from(snapshot.inviteCode.ciphertext)).toEqual(inviteCiphertext);

    transaction.agentProfile.findUnique.mockResolvedValueOnce(agentRecord({
      account: { deleted_at: null, id: otherAccountId, role: 'AGENT_ADMIN', status: 'ACTIVE' },
      account_id: otherAccountId,
    }));
    await expect(commerce.getPromotionAsset({ accountId, agentId, promotionAssetId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('returns only an exactly bound READY private promotion QR for the authenticated Agent', async () => {
    const fileAsset = {
      findFirst: vi.fn(async () => ({
        byte_size: 1_024n,
        id: qrFileId,
        mime_type: 'image/png',
        object_key: `private/${qrFileId}`,
        purpose: 'PROMOTION_QR',
        sha256: qrSha256,
        status: 'READY',
        visibility: 'PRIVATE',
      })),
    };
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => agentRecord()) },
      fileAsset,
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
        work(transaction as unknown as DatabaseTransaction)),
    };
    const commerce = repository(prisma as unknown as PrismaClient);

    await expect(commerce.getAgentPromotionQrDownloadable({ accountId, agentId, fileId: qrFileId }))
      .resolves.toEqual({
        byteSize: 1_024n,
        id: qrFileId,
        mimeType: 'image/png',
        objectKey: `private/${qrFileId}`,
        purpose: 'PROMOTION_QR',
        sha256: qrSha256,
        status: 'READY',
        visibility: 'PRIVATE',
      });
    expect(fileAsset.findFirst).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: {
        created_by_id: accountId,
        deleted_at: null,
        id: qrFileId,
        object_key: `private/${qrFileId}`,
        promotion_qr_files: { some: { agent_id: agentId } },
        purpose: 'PROMOTION_QR',
        status: 'READY',
        visibility: 'PRIVATE',
      },
    });

    fileAsset.findFirst.mockResolvedValueOnce(null);
    await expect(commerce.getAgentPromotionQrDownloadable({ accountId, agentId, fileId: qrFileId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
