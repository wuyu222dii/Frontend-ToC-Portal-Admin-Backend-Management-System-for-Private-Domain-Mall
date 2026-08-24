import { randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditRepository } from './audit.repository';
import { FileAssetRepository } from './file-asset.repository';
import {
  IdempotencyRepository,
  type IdempotencyClaim,
  type IdempotencyHashKey,
} from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B3_FILE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B3_FILE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const remoteRollbackTransactionOptions = mode === 'rollback'
  ? {
      isolationLevel: 'Serializable' as const,
      maxWait: 15_000,
      timeout: 60_000,
    }
  : undefined;
const remoteRollbackTestTimeoutMs = 90_000;
const rollbackSentinel = Object.freeze({ code: 'B3_FILE_ROLLBACK_SENTINEL' });
const now = new Date('2026-08-14T12:00:00.000Z');
const auditKey = Buffer.alloc(32, 0x62);
const idempotencyHashKey: IdempotencyHashKey = {
  id: 'b3-file-integration-v1',
  key: Buffer.alloc(32, 0x63),
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B3 file database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B3 file database tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new TypeError('Full B3 file database tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b3-file-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 6,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B3 file database tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b3-file-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function claim(actorId: string, fileId: string, key = randomUUID()): IdempotencyClaim {
  return {
    actorId,
    idempotencyKey: key,
    request: {
      body: { sha256: 'a'.repeat(64), size: 1_024 },
      method: 'POST',
      pathParameters: { file_id: fileId },
      route: '/files/{file_id}/complete',
    },
  };
}

databaseDescribe('B3 file database integration', () => {
  let runtime: DatabaseRuntime;
  let files: FileAssetRepository;
  let audit: AuditRepository;
  let idempotency: IdempotencyRepository;

  beforeAll(async () => {
    runtime = runtimeForMode();
    files = new FileAssetRepository(runtime.prisma, () => now);
    audit = new AuditRepository(auditKey, () => now);
    idempotency = new IdempotencyRepository({ current: idempotencyHashKey, previous: [] }, () => now);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function createActorAndPending(fileId: string, actorId: string): Promise<void> {
    await runtime.prisma.account.create({
      data: {
        created_at: now,
        id: actorId,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await runtime.withPrismaTransaction((transaction) => files.createPendingInTransaction(transaction, {
      actorId,
      byteSize: 1_024n,
      id: fileId,
      mimeType: 'image/png',
      originalName: 'integration.png',
      purpose: 'BRAND_LOGO',
      sha256: 'a'.repeat(64),
    }));
  }

  async function verifyAtomicRollback(): Promise<void> {
    const actorId = generateUlid();
    const fileId = generateUlid();
    const key = randomUUID();
    const auditRequestId = requestId();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: { id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      const intent = claim(actorId, fileId, key);
      expect(await idempotency.claim(transaction, intent)).toEqual({ kind: 'execute' });
      await files.createPendingInTransaction(transaction, {
        actorId,
        byteSize: 1_024n,
        id: fileId,
        mimeType: 'image/png',
        originalName: 'rollback.png',
        purpose: 'BRAND_LOGO',
        sha256: 'a'.repeat(64),
      });
      await audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: actorId,
        actorRole: 'SUPER_ADMIN',
        after: { status: 'PENDING' },
        idempotencyKey: key,
        module: 'file',
        objectId: fileId,
        objectType: 'file',
        requestId: auditRequestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      });
      await idempotency.complete(transaction, intent, {
        resourceId: fileId,
        responseForHash: { file_id: fileId, status: 'PENDING' },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      throw rollbackSentinel;
    }, remoteRollbackTransactionOptions)).rejects.toBe(rollbackSentinel);
    await expect(Promise.all([
      runtime.prisma.fileAsset.count({ where: { id: fileId } }),
      runtime.prisma.auditLog.count({ where: { request_id: auditRequestId } }),
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: actorId, idempotency_key: key } }),
      runtime.prisma.account.count({ where: { id: actorId } }),
    ])).resolves.toEqual([0, 0, 0, 0]);
  }

  rollbackIt(
    'rolls back intent, audit, idempotency and actor facts without residue',
    verifyAtomicRollback,
    remoteRollbackTestTimeoutMs,
  );
  fullIt('rolls back intent, audit, idempotency and actor facts without residue', verifyAtomicRollback);

  fullIt('commits one READY transition and exactly replays its completion response', async () => {
    const actorId = generateUlid();
    const fileId = generateUlid();
    await createActorAndPending(fileId, actorId);
    const completionClaim = claim(actorId, fileId);
    const response = await runSerializableTransaction(runtime.prisma, async (transaction) => {
      expect(await idempotency.claim(transaction, completionClaim)).toEqual({ kind: 'execute' });
      const ready = await files.markReadyInTransaction(transaction, {
        actorId,
        expectedByteSize: 1_024n,
        expectedSha256: 'a'.repeat(64),
        fileId,
        measuredByteSize: 1_024n,
        measuredMimeType: 'image/png',
        measuredSha256: 'a'.repeat(64),
      });
      const body = {
        code: 'OK' as const,
        data: {
          completed_at: ready.completedAt.toISOString(),
          file_id: fileId,
          public_url: `https://assets.example.test/public/${fileId}`,
          purpose: ready.asset.purpose,
          status: 'READY' as const,
        },
        message: 'success' as const,
        request_id: requestId(),
      };
      await audit.append(transaction, {
        action: 'COMPLETE',
        actorAccountId: actorId,
        actorRole: 'SUPER_ADMIN',
        after: { status: 'READY' },
        before: { status: 'PENDING' },
        idempotencyKey: completionClaim.idempotencyKey,
        module: 'file',
        objectId: fileId,
        objectType: 'file',
        requestId: body.request_id,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      });
      await idempotency.complete(transaction, completionClaim, {
        policy: 'FILE_UPLOAD_COMPLETE',
        responseBody: body,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return body;
    });

    const replay = await runtime.withPrismaTransaction((transaction) => idempotency.claim(transaction, completionClaim));
    expect(replay.kind).toBe('replay');
    if (replay.kind === 'replay') expect(idempotency.fileUploadCompleteReplay(replay.record)).toEqual(response);
    await expect(runtime.withPrismaTransaction((transaction) => files.getOwnedPendingInTransaction(transaction, {
      actorId,
      fileId,
    }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
