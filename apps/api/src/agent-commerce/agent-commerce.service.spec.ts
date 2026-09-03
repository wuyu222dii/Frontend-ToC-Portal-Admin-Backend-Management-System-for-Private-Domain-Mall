import { createHash } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AgentPromotionAssetSnapshot,
  CurrentAgentSession,
  DatabaseRuntime,
} from '@qingxu/database';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileObjectLeaseManager } from '../files/file-object-lease';
import { createAgentInviteCodeMaterial } from '../platform/security/agent-security';
import { AgentCommerceService } from './agent-commerce.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const INVITE_ID = '01J00000000000000000000002';
const PRODUCT_ID = '01J00000000000000000000003';
const INVITE_CODE = 'AGT-abcdefghijklmnop';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const FIELD_KEY = { id: 'field-v1', key: Buffer.alloc(32, 1) };

function runtimeConfig(): PlatformRuntimeConfig {
  return {
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    encryption: {
      fieldKeys: { current: FIELD_KEY, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    storage: {
      maxUploadBytes: 5_242_880,
      pendingCleanupAgeSeconds: 86_400,
      uploadTtlSeconds: 900,
    },
  } as unknown as PlatformRuntimeConfig;
}

function session(): CurrentAgentSession {
  return {
    accountId: ACCOUNT_ID,
    agentId: AGENT_ID,
    restriction: 'NONE',
    sessionId: '01J00000000000000000000004',
  } as CurrentAgentSession;
}

interface Internals {
  audit: { append: ReturnType<typeof vi.fn> };
  commerce: {
    createPromotionAssetInTransaction: ReturnType<typeof vi.fn>;
    getPromotionAsset: ReturnType<typeof vi.fn>;
    getPromotionCreationContext: ReturnType<typeof vi.fn>;
  };
  files: { createPendingInTransaction: ReturnType<typeof vi.fn> };
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
}

describe('AgentCommerceService promotion creation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('generates one server QR and replays without storing or regenerating its invite code', async () => {
    const config = runtimeConfig();
    const transaction = {};
    const database = {
      prisma: { $transaction: vi.fn((work: (value: unknown) => unknown) => work(transaction)) },
    } as unknown as DatabaseRuntime;
    let uploaded = Buffer.alloc(0);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      uploaded = Buffer.from(init?.body as Uint8Array);
      return { body: null, ok: true } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const storage = {
      copyIfAbsent: vi.fn(async (input: { byteSize: number; mimeType: 'image/png'; sha256Hex: string }) => ({
        copied: true,
        verified: { ...input, etag: '"0123456789abcdef0123456789abcdef"' },
      })),
      deleteIfExists: vi.fn().mockResolvedValue(undefined),
      inspectAndHash: vi.fn(async () => ({
        byteSize: uploaded.length,
        etag: '"0123456789abcdef0123456789abcdef"',
        mimeType: 'image/png' as const,
        sha256Hex: createHash('sha256').update(uploaded).digest('hex'),
      })),
      presignPut: vi.fn().mockResolvedValue({
        expiresAt: new Date(),
        headers: [{ name: 'content-type', value: 'image/png' }],
        url: 'https://storage.example.test/staging',
      }),
      publicUrl: vi.fn(),
    } as unknown as ObjectStoragePort;
    const lease = { assertOwned: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
    const leases = { acquire: vi.fn().mockResolvedValue(lease) } as unknown as FileObjectLeaseManager;
    const service = new AgentCommerceService(config, database, storage, leases);
    const internals = service as unknown as Internals;
    const material = createAgentInviteCodeMaterial(
      INVITE_ID,
      INVITE_CODE,
      FIELD_KEY,
      { id: 'secret-v1', key: Buffer.alloc(32, 4) },
    );
    let createdAsset: AgentPromotionAssetSnapshot | undefined;
    let replayRecord: { resource_id: string } | undefined;
    let claimCount = 0;
    internals.idempotency = {
      assertHashOnlyReplay: vi.fn(),
      claim: vi.fn(async () => {
        claimCount += 1;
        return claimCount <= 2 ? { kind: 'execute' } : { kind: 'replay', record: replayRecord };
      }),
      complete: vi.fn(async (_transaction, _claim, result: { resourceId: string }) => {
        replayRecord = { resource_id: result.resourceId };
      }),
    };
    internals.audit = { append: vi.fn().mockResolvedValue({}) };
    internals.files = { createPendingInTransaction: vi.fn().mockResolvedValue({}) };
    internals.outbox = { append: vi.fn().mockResolvedValue({}) };
    internals.commerce = {
      getPromotionCreationContext: vi.fn().mockResolvedValue({
        accountId: ACCOUNT_ID,
        agentId: AGENT_ID,
        authorizationVersion: 3,
        inviteCode: {
          ciphertext: material.ciphertext,
          encryptionKeyId: material.encryptionKeyId,
          expiresAt: null,
          id: INVITE_ID,
        },
        targetProductId: PRODUCT_ID,
        targetType: 'PRODUCT',
      }),
      createPromotionAssetInTransaction: vi.fn(async (_transaction, input) => {
        createdAsset = {
          agentId: AGENT_ID,
          attributionEligible: true,
          authorizationVersion: 3,
          createdAt: new Date('2026-09-03T00:00:00.000Z'),
          expiresAt: null,
          id: input.promotionAssetId,
          inviteCode: { ciphertext: material.ciphertext, encryptionKeyId: material.encryptionKeyId, id: INVITE_ID },
          inviteCodeId: INVITE_ID,
          publicUrl: input.publicUrl,
          qrFile: {
            byteSize: input.qrFile.byteSize,
            createdAt: new Date('2026-09-03T00:00:00.000Z'),
            createdById: ACCOUNT_ID,
            deletedAt: null,
            id: input.qrFile.fileId,
            mimeType: 'image/png',
            objectKey: `private/${input.qrFile.fileId}`,
            originalName: 'promotion-qr.png',
            purpose: 'PROMOTION_QR',
            sha256: input.qrFile.sha256,
            status: 'READY',
            visibility: 'PRIVATE',
          },
          targetProductId: PRODUCT_ID,
          targetType: 'PRODUCT',
        };
        return createdAsset;
      }),
      getPromotionAsset: vi.fn(async () => createdAsset),
    };

    const input = { targetId: PRODUCT_ID, targetType: 'PRODUCT' as const };
    const first = await service.createPromotionAsset(
      session(), input, IDEMPOTENCY_KEY, 'request-first', '203.0.113.9',
    );
    const replay = await service.createPromotionAsset(session(), input, IDEMPOTENCY_KEY, 'request-replay');

    expect(uploaded.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(new URL(first.public_url).searchParams.get('invite_code')).toBe(INVITE_CODE);
    expect(first).toEqual(replay);
    expect(first.qr_file).toMatchObject({ purpose: 'PROMOTION_QR', status: 'READY', visibility: 'PRIVATE' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(internals.files.createPendingInTransaction).toHaveBeenCalledWith(transaction, expect.objectContaining({
      actorId: ACCOUNT_ID,
      purpose: 'PROMOTION_QR',
    }));
    expect(internals.files.createPendingInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(storage.presignPut).mock.invocationCallOrder[0]!);
    expect(internals.commerce.createPromotionAssetInTransaction).toHaveBeenCalledOnce();
    expect(internals.audit.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      ipAddress: '203.0.113.9',
    }));
    expect(internals.idempotency.assertHashOnlyReplay).toHaveBeenCalledOnce();
    expect(leases.acquire).toHaveBeenCalledOnce();
    expect(lease.assertOwned).toHaveBeenCalledTimes(2);
    expect(lease.release).toHaveBeenCalledOnce();
    expect(storage.deleteIfExists).toHaveBeenCalledOnce();
  });
});
