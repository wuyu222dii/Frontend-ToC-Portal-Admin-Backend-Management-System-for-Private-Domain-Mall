import { createHash, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import { FILE_STAGING_CLEANUP_EVENT_TYPE, type DatabaseRuntime } from '@qingxu/database';
import { generateUlid, signAccessToken } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdminAuthController } from '../admin-auth/admin-auth.controller';
import { AdminLoginRateLimiter } from '../admin-auth/admin-login-rate-limiter';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { ApiRuntimeModule } from '../api-runtime.module';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import { FileObjectLeaseManager } from './file-object-lease';
import { FilesController } from './files.controller';
import { FileAssetsService } from './files.service';

const mode = process.env.B3_FILE_API_TEST_MODE;
if (mode !== undefined && mode !== 'full') {
  throw new TypeError('B3_FILE_API_TEST_MODE must be full');
}
const integrationDescribe = mode === 'full' ? describe : describe.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface UploadIntentData {
  expires_at: string;
  file_id: string;
  purpose: string;
  status: 'PENDING';
  upload_headers: Array<{ name: string; value: string }>;
  upload_url: string;
}

interface CompleteData {
  completed_at: string;
  file_id: string;
  public_url: string | null;
  purpose: string;
  status: 'READY';
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function expectNoStore(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function assertFullModeTargets(): void {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    throw new TypeError('B3 file API integration requires the explicit ephemeral CI capability');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(databaseUrl.hostname) || decodeURIComponent(databaseUrl.username) !== 'mall_runtime' ||
    !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
    !/(?:^|[-_])(?:b3\d*|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    throw new TypeError('B3 file API integration requires a loopback mall_runtime B3 test database');
  }
  const redisUrl = new URL(process.env.REDIS_URL ?? '');
  if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
    decodeURIComponent(redisUrl.password).length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
    throw new TypeError('B3 file API integration requires a password-authenticated loopback Redis');
  }
  const storageUrl = new URL(process.env.S3_ENDPOINT ?? '');
  const publicBaseUrl = new URL(process.env.S3_PUBLIC_BASE_URL ?? '');
  const bucket = process.env.S3_BUCKET ?? '';
  if (storageUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storageUrl.hostname) ||
    storageUrl.username !== '' || storageUrl.password !== '' || storageUrl.pathname !== '/' ||
    storageUrl.search !== '' || storageUrl.hash !== '' || !bucket.startsWith('mall-b3-') ||
    publicBaseUrl.origin !== storageUrl.origin || publicBaseUrl.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBaseUrl.search !== '' || publicBaseUrl.hash !== '') {
    throw new TypeError('B3 file API integration requires an isolated loopback mall-b3-* MinIO bucket');
  }
}

integrationDescribe('B3 file PostgreSQL, Redis and MinIO API integration', () => {
  let app: INestApplication;
  let config: PlatformRuntimeConfig;
  let database: DatabaseRuntime;
  let storage: ObjectStoragePort;
  let accountId: string;
  let accessToken: string;
  let otherAccessToken: string;
  const fileIds = new Set<string>();
  const signedUrls = new Set<string>();
  const intentKeys = new Set<string>();
  const successfulCompleteKeys = new Set<string>();

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('b3-api-integration-png'),
  ]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('b3-api-integration-jpeg'),
  ]);

  async function createAuthenticatedActor(label: string): Promise<{ accountId: string; accessToken: string }> {
    const now = new Date();
    const actorId = generateUlid();
    const factorId = generateUlid();
    const sessionId = generateUlid();
    const accessJti = `access:${generateUlid()}`;
    await database.prisma.account.create({
      data: {
        id: actorId,
        login_name: `${label}-${actorId}`.slice(0, 80),
        password_hash: `integration:${sha256(actorId)}`,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });
    await database.prisma.totpFactor.create({
      data: {
        account_id: actorId,
        encryption_key_id: config.encryption.fieldKeys.current.id,
        id: factorId,
        label,
        secret_ciphertext: Buffer.alloc(32, 0x31),
        secret_fingerprint: sha256(`factor:${factorId}`),
        status: 'ACTIVE',
        verified_at: now,
      },
    });
    await database.prisma.authSession.create({
      data: {
        access_jti: accessJti,
        account_id: actorId,
        assurance: 'MFA',
        expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
        id: sessionId,
        mfa_factor_id: factorId,
        mfa_verified_at: now,
        refresh_token_hash: sha256(`refresh:${sessionId}:${randomUUID()}`),
        restriction: 'NONE',
        session_family: generateUlid(),
      },
    });
    const token = signAccessToken({
      audience: config.authentication.audience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      accountId: actorId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
      tokenId: accessJti,
    }, config.authentication.accessTokenTtlSeconds).token;
    return { accountId: actorId, accessToken: token };
  }

  beforeAll(async () => {
    assertFullModeTargets();
    config = loadPlatformConfig(process.env, { service: 'api' });

    // Vitest's transform does not emit design metadata, so restore the Nest constructor graph.
    Reflect.defineMetadata('design:paramtypes', [Object, Object, AdminLoginRateLimiter], AdminAuthService);
    Reflect.defineMetadata('design:paramtypes', [AdminAuthService], AdminAuthController);
    Reflect.defineMetadata(
      'design:paramtypes',
      [Object, Object, Object, FileObjectLeaseManager],
      FileAssetsService,
    );
    Reflect.defineMetadata('design:paramtypes', [FileAssetsService], FilesController);

    const moduleRef = await Test.createTestingModule({
      imports: [ApiRuntimeModule.register(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    database = app.get(API_DATABASE_RUNTIME);
    storage = app.get(API_OBJECT_STORAGE);

    const actor = await createAuthenticatedActor('B3 file API integration');
    accountId = actor.accountId;
    accessToken = actor.accessToken;
    otherAccessToken = (await createAuthenticatedActor('B3 cross-owner integration')).accessToken;
  }, 60_000);

  afterAll(async () => {
    if (storage) {
      await Promise.allSettled([...fileIds].flatMap((fileId) => [
        storage.deleteIfExists(`staging/${fileId}`),
        storage.deleteIfExists(`public/${fileId}`),
        storage.deleteIfExists(`private/${fileId}`),
      ]));
    }
    await app?.close();
  }, 30_000);

  function authenticatedPost(path: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey);
  }

  async function createIntent(input: {
    bytes: Buffer;
    filename: string;
    mimeType: 'image/jpeg' | 'image/png';
    purpose: string;
    sha?: string;
  }): Promise<{ data: UploadIntentData; key: string; response: request.Response }> {
    const key = randomUUID();
    const response = await authenticatedPost('/api/v1/files/upload-intents', key)
      .send({
        filename: input.filename,
        mime_type: input.mimeType,
        purpose: input.purpose,
        sha256: input.sha ?? sha256(input.bytes),
        size: input.bytes.length,
      })
      .expect(200);
    expectNoStore(response);
    const data = response.body.data as UploadIntentData;
    expect(data).toMatchObject({ purpose: input.purpose, status: 'PENDING' });
    expect(data.file_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(data.upload_url).toMatch(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/);
    fileIds.add(data.file_id);
    signedUrls.add(data.upload_url);
    intentKeys.add(key);
    return { data, key, response };
  }

  async function putIntent(data: UploadIntentData, bytes: Buffer): Promise<void> {
    const headers = Object.fromEntries(data.upload_headers.map(({ name, value }) => [name, value]));
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const response = await fetch(data.upload_url, { body, headers, method: 'PUT' });
    expect(response.ok).toBe(true);
  }

  function complete(
    fileId: string,
    bytes: Buffer,
    key = randomUUID(),
  ) {
    return authenticatedPost(`/api/v1/files/${fileId}/complete`, key)
      .send({ sha256: sha256(bytes), size: bytes.length });
  }

  it('completes a public upload, serves it anonymously and exactly replays one completion', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .post('/api/v1/files/upload-intents')
      .set('Idempotency-Key', randomUUID())
      .send({ filename: 'denied.png', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256: sha256(png), size: png.length })
      .expect(401);
    expectNoStore(unauthenticated);

    const intent = await createIntent({ bytes: png, filename: 'brand.png', mimeType: 'image/png', purpose: 'BRAND_LOGO' });
    await putIntent(intent.data, png);
    const completionKey = randomUUID();
    const first = await complete(intent.data.file_id, png, completionKey).expect(200);
    expectNoStore(first);
    successfulCompleteKeys.add(completionKey);
    const completed = first.body.data as CompleteData;
    expect(completed).toMatchObject({
      file_id: intent.data.file_id,
      purpose: 'BRAND_LOGO',
      status: 'READY',
    });
    expect(completed.public_url).toBe(`${config.storage.publicBaseUrl}/public/${intent.data.file_id}`);
    await expect(storage.inspectAndHash({
      key: `staging/${intent.data.file_id}`,
      maxBytes: config.storage.maxUploadBytes,
    })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });

    const replay = await complete(intent.data.file_id, png, completionKey).expect(200);
    expectNoStore(replay);
    expect(replay.body).toEqual(first.body);
    const newKeyConflict = await complete(intent.data.file_id, png).expect(409);
    expectNoStore(newKeyConflict);
    expect(newKeyConflict.body.code).toBe('STATE_CONFLICT');

    const publicObject = await fetch(completed.public_url as string);
    expect(publicObject.status).toBe(200);
    expect(Buffer.from(await publicObject.arrayBuffer())).toEqual(png);
    const publicDownloadRoute = await request(app.getHttpServer())
      .get(`/api/v1/files/${intent.data.file_id}/download-url`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expectNoStore(publicDownloadRoute);

    const asset = await database.prisma.fileAsset.findUniqueOrThrow({ where: { id: intent.data.file_id } });
    expect(asset).toMatchObject({
      byte_size: BigInt(png.length),
      mime_type: 'image/png',
      object_key: `public/${intent.data.file_id}`,
      sha256: sha256(png),
      status: 'READY',
      visibility: 'PUBLIC',
    });
    expect(await database.prisma.auditLog.count({
      where: { action: 'COMPLETE', actor_account_id: accountId, object_id: intent.data.file_id },
    })).toBe(1);
    const cleanupEvents = await database.prisma.outboxEvent.findMany({
      where: {
        aggregate_id: intent.data.file_id,
        event_type: FILE_STAGING_CLEANUP_EVENT_TYPE,
      },
    });
    expect(cleanupEvents).toHaveLength(1);
    expect(cleanupEvents[0]).toMatchObject({
      aggregate_type: 'file',
      payload: {
        event_version: 1,
        resource_id: intent.data.file_id,
        resource_type: 'file',
        resource_version: 1,
      },
      retry_count: 0,
      status: 'PENDING',
    });
    expect(cleanupEvents[0]?.next_retry_at).toEqual(new Date(
      asset.created_at.getTime() +
      (config.storage.uploadTtlSeconds + config.storage.pendingCleanupAgeSeconds) * 1_000 +
      60_000,
    ));
  }, 60_000);

  it('keeps private objects private and leaves hash or MIME mismatches pending', async () => {
    const privateIntent = await createIntent({
      bytes: jpeg,
      filename: 'evidence.jpg',
      mimeType: 'image/jpeg',
      purpose: 'AFTERSALE_EVIDENCE',
    });
    await putIntent(privateIntent.data, jpeg);
    const privateKey = randomUUID();
    const privateCompletion = await complete(privateIntent.data.file_id, jpeg, privateKey).expect(200);
    expectNoStore(privateCompletion);
    successfulCompleteKeys.add(privateKey);
    expect(privateCompletion.body.data).toMatchObject({
      file_id: privateIntent.data.file_id,
      public_url: null,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
    });

    const directPrivate = await fetch(`${config.storage.endpoint}/${config.storage.bucket}/private/${privateIntent.data.file_id}`);
    expect(directPrivate.ok).toBe(false);
    const crossOwnerComplete = await request(app.getHttpServer())
      .post(`/api/v1/files/${privateIntent.data.file_id}/complete`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ sha256: sha256(jpeg), size: jpeg.length })
      .expect(404);
    expectNoStore(crossOwnerComplete);
    expect(crossOwnerComplete.body.code).toBe('RESOURCE_NOT_FOUND');
    const crossOwnerDownload = await request(app.getHttpServer())
      .get(`/api/v1/files/${privateIntent.data.file_id}/download-url`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(404);
    expectNoStore(crossOwnerDownload);
    expect(crossOwnerDownload.body.code).toBe('RESOURCE_NOT_FOUND');
    const download = await request(app.getHttpServer())
      .get(`/api/v1/files/${privateIntent.data.file_id}/download-url`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expectNoStore(download);
    const downloadUrl = download.body.data.download_url as string;
    signedUrls.add(downloadUrl);
    const signedPrivate = await fetch(downloadUrl);
    expect(signedPrivate.status).toBe(200);
    expect(Buffer.from(await signedPrivate.arrayBuffer())).toEqual(jpeg);
    const sensitiveReads = await database.prisma.auditLog.findMany({
      where: {
        action: 'READ_SENSITIVE',
        actor_account_id: accountId,
        object_id: privateIntent.data.file_id,
      },
    });
    expect(sensitiveReads).toHaveLength(1);
    expect(sensitiveReads[0]).toMatchObject({
      after_json: null,
      before_json: null,
      idempotency_key: null,
      module: 'file',
      reason: null,
      result: 'SUCCESS',
    });

    const declaredHash = sha256(Buffer.concat([png, Buffer.from('different')]));
    const hashIntent = await createIntent({
      bytes: png,
      filename: 'hash-mismatch.png',
      mimeType: 'image/png',
      purpose: 'CATEGORY_ICON',
      sha: declaredHash,
    });
    await putIntent(hashIntent.data, png);
    const hashMismatch = await authenticatedPost(`/api/v1/files/${hashIntent.data.file_id}/complete`, randomUUID())
      .send({ sha256: declaredHash, size: png.length })
      .expect(422);
    expectNoStore(hashMismatch);
    expect(hashMismatch.body.code).toBe('FILE_CONTENT_MISMATCH');

    const mimeIntent = await createIntent({
      bytes: jpeg,
      filename: 'mime-mismatch.png',
      mimeType: 'image/png',
      purpose: 'CATEGORY_ICON',
    });
    await putIntent(mimeIntent.data, jpeg);
    const mimeMismatch = await complete(mimeIntent.data.file_id, jpeg).expect(422);
    expectNoStore(mimeMismatch);
    expect(mimeMismatch.body.code).toBe('FILE_CONTENT_MISMATCH');

    const pending = await database.prisma.fileAsset.findMany({
      where: { id: { in: [hashIntent.data.file_id, mimeIntent.data.file_id] } },
      orderBy: { id: 'asc' },
    });
    expect(pending).toHaveLength(2);
    expect(pending.every(({ object_key, status }) => status === 'PENDING' && object_key.startsWith('staging/')))
      .toBe(true);
  }, 60_000);

  it('serializes concurrent completion and persists no signed URL', async () => {
    const intent = await createIntent({ bytes: png, filename: 'concurrent.png', mimeType: 'image/png', purpose: 'BANNER' });
    await putIntent(intent.data, png);
    const keys = [randomUUID(), randomUUID()] as const;
    const responses = await Promise.all(keys.map((key) => complete(intent.data.file_id, png, key)));
    const statuses = responses.map(({ status }) => status).sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    for (const response of responses) expectNoStore(response);
    const winningIndex = responses.findIndex(({ status }) => status === 200);
    const winningKey = keys[winningIndex];
    expect(winningKey).toBeDefined();
    successfulCompleteKeys.add(winningKey as string);

    expect(await database.prisma.auditLog.count({
      where: { action: 'COMPLETE', actor_account_id: accountId, object_id: intent.data.file_id },
    })).toBe(1);
    const fileRecords = await database.prisma.idempotencyRecord.findMany({
      where: { actor_id: accountId, resource_id: intent.data.file_id },
    });
    expect(fileRecords.filter(({ response_body }) => response_body !== null)).toHaveLength(1);

    const [records, audit, outbox] = await Promise.all([
      database.prisma.idempotencyRecord.findMany({ where: { actor_id: accountId } }),
      database.prisma.auditLog.findMany({ where: { actor_account_id: accountId, module: 'file' } }),
      database.prisma.outboxEvent.findMany({
        where: { event_type: FILE_STAGING_CLEANUP_EVENT_TYPE, aggregate_id: { in: [...fileIds] } },
      }),
    ]);
    const recordByKey = new Map(records.map((record) => [record.idempotency_key, record]));
    for (const key of intentKeys) {
      expect(recordByKey.get(key)).toMatchObject({ response_body: null, response_status: 200 });
    }
    for (const key of successfulCompleteKeys) {
      expect(recordByKey.get(key)?.response_body).not.toBeNull();
      expect(recordByKey.get(key)?.response_status).toBe(200);
    }
    expect(audit.every(({ after_json, before_json, reason }) =>
      after_json === null && before_json === null && reason === null)).toBe(true);
    expect(outbox).toHaveLength(successfulCompleteKeys.size);
    expect(outbox.every(({ payload }) => JSON.stringify(payload).includes('completed_at') === false)).toBe(true);
    const persistedFacts = JSON.stringify({ audit, outbox, records });
    for (const signedUrl of signedUrls) expect(persistedFacts).not.toContain(signedUrl);
    expect(persistedFacts).not.toContain('X-Amz-Signature');
    expect(persistedFacts).not.toContain('x-amz-signature');
  }, 60_000);
});
