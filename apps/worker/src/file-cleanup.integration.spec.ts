import { createHash, randomUUID } from 'node:crypto';

import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  buildFinalObjectKey,
  buildStagingObjectKey,
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  FileAssetRepository,
  OutboxRepository,
  type DatabaseRuntime,
} from '@qingxu/database';
import { createS3ObjectStorage, type ObjectStoragePort } from '@qingxu/storage';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkerDatabaseRuntime } from './database-runtime.provider';
import {
  FileCleanupService,
  type WorkerRedisClient,
} from './file-cleanup.service';

const mode = process.env.B3_FILE_WORKER_TEST_MODE;
if (mode !== undefined && mode !== 'full') {
  throw new TypeError('B3_FILE_WORKER_TEST_MODE must be full');
}
const integrationDescribe = mode === 'full' ? describe : describe.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function testUlid(): string {
  return randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase();
}

function assertFullModeTargets(): void {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    throw new TypeError('B3 file worker integration requires the explicit ephemeral CI capability');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(databaseUrl.hostname) || decodeURIComponent(databaseUrl.username) !== 'mall_runtime' ||
    !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
    !/(?:^|[-_])(?:b3\d*|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    throw new TypeError('B3 file worker integration requires a loopback mall_runtime B3 test database');
  }
  const redisUrl = new URL(process.env.REDIS_URL ?? '');
  if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
    decodeURIComponent(redisUrl.password).length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
    throw new TypeError('B3 file worker integration requires a password-authenticated loopback Redis');
  }
  const storageUrl = new URL(process.env.S3_ENDPOINT ?? '');
  const publicBaseUrl = new URL(process.env.S3_PUBLIC_BASE_URL ?? '');
  const bucket = process.env.S3_BUCKET ?? '';
  if (storageUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storageUrl.hostname) ||
    storageUrl.username !== '' || storageUrl.password !== '' || storageUrl.pathname !== '/' ||
    storageUrl.search !== '' || storageUrl.hash !== '' || !bucket.startsWith('mall-b3-') ||
    publicBaseUrl.origin !== storageUrl.origin || publicBaseUrl.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBaseUrl.search !== '' || publicBaseUrl.hash !== '') {
    throw new TypeError('B3 file worker integration requires an isolated loopback mall-b3-* MinIO bucket');
  }
}

integrationDescribe('B3 file worker PostgreSQL, Redis and MinIO integration', () => {
  let config: PlatformRuntimeConfig;
  let database: DatabaseRuntime;
  let redis: WorkerRedisClient;
  let storage: ObjectStoragePort;
  let files: FileAssetRepository;
  let outbox: OutboxRepository;
  let service: FileCleanupService;
  let actorId: string;
  let failedDeleteKey: string | undefined;
  let remainingDeleteFailures = 0;
  const deleteCalls: string[] = [];
  const fileIds = new Set<string>();
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('b3-worker-integration-png'),
  ]);

  beforeAll(async () => {
    assertFullModeTargets();
    config = loadPlatformConfig(process.env, { service: 'worker' });
    database = createWorkerDatabaseRuntime(config);
    await database.connect();
    files = new FileAssetRepository(database.prisma);
    outbox = new OutboxRepository(database);
    storage = createS3ObjectStorage(config.storage);
    redis = createClient({
      url: config.redis.url,
      socket: {
        connectTimeout: config.database.connectionTimeoutMs,
        reconnectStrategy: false,
      },
    }) as unknown as WorkerRedisClient;
    await redis.connect();

    const serviceStorage: ObjectStoragePort = {
      copyIfAbsent: (input) => storage.copyIfAbsent(input),
      deleteIfExists: async (key) => {
        deleteCalls.push(key);
        if (key === failedDeleteKey && remainingDeleteFailures > 0) {
          remainingDeleteFailures -= 1;
          throw new Error('injected object deletion failure');
        }
        await storage.deleteIfExists(key);
      },
      inspectAndHash: (input) => storage.inspectAndHash(input),
      presignGet: (key, expiresInSeconds) => storage.presignGet(key, expiresInSeconds),
      presignPut: (input) => storage.presignPut(input),
      publicUrl: (key) => storage.publicUrl(key),
    };
    service = new FileCleanupService(
      database,
      config,
      files,
      new AuditRepository(config.encryption.ipHashKey),
      serviceStorage,
      redis,
      outbox,
    );
    actorId = testUlid();
    await database.prisma.account.create({
      data: { id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
  }, 60_000);

  afterAll(async () => {
    if (storage) {
      await Promise.allSettled([...fileIds].flatMap((fileId) => [
        storage.deleteIfExists(buildStagingObjectKey(fileId)),
        storage.deleteIfExists(buildFinalObjectKey(fileId, 'BRAND_LOGO')),
      ]));
    }
    if (redis?.isOpen) await redis.quit();
    await database?.disconnect();
  }, 30_000);

  async function uploadStagingAndCopyFinal(fileId: string): Promise<{ finalKey: string; stagingKey: string }> {
    const stagingKey = buildStagingObjectKey(fileId);
    const finalKey = buildFinalObjectKey(fileId, 'BRAND_LOGO');
    const signed = await storage.presignPut({
      byteSize: png.length,
      expiresInSeconds: 60,
      key: stagingKey,
      mimeType: 'image/png',
      sha256Hex: sha256(png),
    });
    const headers = Object.fromEntries(signed.headers.map(({ name, value }) => [name, value]));
    const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
    const upload = await fetch(signed.url, { body, headers, method: 'PUT' });
    expect(upload.ok).toBe(true);
    const measured = await storage.inspectAndHash({ key: stagingKey, maxBytes: config.storage.maxUploadBytes });
    await storage.copyIfAbsent({ destinationKey: finalKey, sourceKey: stagingKey, ...measured });
    return { finalKey, stagingKey };
  }

  async function createFile(
    fileId: string,
    status: 'PENDING' | 'READY',
    createdAt: Date,
  ): Promise<void> {
    await database.prisma.fileAsset.create({
      data: {
        byte_size: BigInt(png.length),
        created_at: createdAt,
        created_by_id: actorId,
        id: fileId,
        mime_type: 'image/png',
        object_key: status === 'PENDING'
          ? buildStagingObjectKey(fileId)
          : buildFinalObjectKey(fileId, 'BRAND_LOGO'),
        original_name: 'worker-integration.png',
        purpose: 'BRAND_LOGO',
        sha256: sha256(png),
        status,
        visibility: status === 'READY' ? 'PUBLIC' : 'PRIVATE',
      },
    });
  }

  async function appendDueCleanupEvent(fileId: string): Promise<string> {
    const event = await database.withPrismaTransaction((transaction) => outbox.append(transaction, {
      aggregateId: fileId,
      aggregateType: 'file',
      eventType: FILE_STAGING_CLEANUP_EVENT_TYPE,
      payload: {
        event_version: 1,
        resource_id: fileId,
        resource_type: 'file',
        resource_version: 1,
      },
    }));
    return event.id;
  }

  async function expectObjectMissing(key: string): Promise<void> {
    await expect(storage.inspectAndHash({ key, maxBytes: config.storage.maxUploadBytes }))
      .rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  }

  it('rechecks PENDING only after the upload window plus 24 hours, then records REJECTED plus audit', async () => {
    const fileId = testUlid();
    fileIds.add(fileId);
    const keys = await uploadStagingAndCopyFinal(fileId);
    await createFile(fileId, 'PENDING', new Date(Date.now() - 25 * 60 * 60 * 1_000));
    const deleteStart = deleteCalls.length;

    await service.cleanupOnce();

    expect(deleteCalls.slice(deleteStart)).toContain(keys.finalKey);
    expect(deleteCalls.slice(deleteStart)).toContain(keys.stagingKey);
    await expectObjectMissing(keys.finalKey);
    await expectObjectMissing(keys.stagingKey);
    expect(await database.prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } }))
      .toMatchObject({ object_key: keys.stagingKey, status: 'REJECTED', visibility: 'PRIVATE' });
    const audits = await database.prisma.auditLog.findMany({
      where: { action: 'REJECT', module: 'file', object_id: fileId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_account_id: null,
      after_json: { status: 'REJECTED' },
      before_json: { status: 'PENDING' },
      result: 'SUCCESS',
      result_code: 'OK',
    });
  }, 60_000);

  it('publishes a due READY event after deleting staging while retaining the final object', async () => {
    const fileId = testUlid();
    fileIds.add(fileId);
    const keys = await uploadStagingAndCopyFinal(fileId);
    await createFile(fileId, 'READY', new Date());
    const eventId = await appendDueCleanupEvent(fileId);

    await service.cleanupOnce();

    await expectObjectMissing(keys.stagingKey);
    const finalObject = await storage.inspectAndHash({ key: keys.finalKey, maxBytes: config.storage.maxUploadBytes });
    expect(finalObject).toMatchObject({ byteSize: png.length, mimeType: 'image/png', sha256Hex: sha256(png) });
    expect(await database.prisma.fileAsset.findUniqueOrThrow({ where: { id: fileId } }))
      .toMatchObject({ object_key: keys.finalKey, status: 'READY', visibility: 'PUBLIC' });
    expect(await database.prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
      .toMatchObject({ error_message: null, next_retry_at: null, retry_count: 0, status: 'PUBLISHED' });
  }, 60_000);

  it('schedules one retry after a storage failure and then converges without deleting the final object', async () => {
    const fileId = testUlid();
    fileIds.add(fileId);
    const keys = await uploadStagingAndCopyFinal(fileId);
    await createFile(fileId, 'READY', new Date());
    const eventId = await appendDueCleanupEvent(fileId);
    failedDeleteKey = keys.stagingKey;
    remainingDeleteFailures = 1;

    await service.cleanupOnce();

    const failed = await database.prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(failed).toMatchObject({
      error_message: 'OUTBOX_HANDLER_FAILED',
      retry_count: 1,
      status: 'FAILED',
    });
    expect(failed.next_retry_at?.getTime()).toBeGreaterThan(Date.now());
    await expect(storage.inspectAndHash({ key: keys.stagingKey, maxBytes: config.storage.maxUploadBytes }))
      .resolves.toMatchObject({ sha256Hex: sha256(png) });
    await database.prisma.outboxEvent.update({
      data: { next_retry_at: new Date(Date.now() - 1) },
      where: { id: eventId },
    });
    failedDeleteKey = undefined;

    await service.cleanupOnce();

    await expectObjectMissing(keys.stagingKey);
    await expect(storage.inspectAndHash({ key: keys.finalKey, maxBytes: config.storage.maxUploadBytes }))
      .resolves.toMatchObject({ sha256Hex: sha256(png) });
    expect(await database.prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
      .toMatchObject({ error_message: null, next_retry_at: null, retry_count: 1, status: 'PUBLISHED' });
  }, 60_000);
});
