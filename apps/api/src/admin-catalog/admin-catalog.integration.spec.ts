import { createHash, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { generateUlid, signAccessToken } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdminAuthController } from '../admin-auth/admin-auth.controller';
import { AdminLoginRateLimiter } from '../admin-auth/admin-login-rate-limiter';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { ApiRuntimeModule } from '../api-runtime.module';
import { FileObjectLeaseManager } from '../files/file-object-lease';
import { FilesController } from '../files/files.controller';
import { FileAssetsService } from '../files/files.service';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';

const mode = process.env.B3_CATALOG_API_TEST_MODE;
if (mode !== undefined && mode !== 'full') {
  throw new TypeError('B3_CATALOG_API_TEST_MODE must be full');
}
const integrationDescribe = mode === 'full' ? describe : describe.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface CatalogView {
  brand_id?: string;
  category_id?: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  version: number;
}

interface PreviewData {
  confirmation_hash: string;
  expires_at: string;
  impact: { affected_count: number; warnings: string[] };
  preview_token: string;
  resource_etag: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertFullModeTargets(): void {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    throw new TypeError('B3 catalog integration requires the explicit ephemeral CI capability');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(databaseUrl.hostname) || decodeURIComponent(databaseUrl.username) !== 'mall_runtime' ||
    !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
    !/(?:^|[-_])(?:b3\d*|catalog|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    throw new TypeError('B3 catalog integration requires a loopback mall_runtime B3 test database');
  }
  const redisUrl = new URL(process.env.REDIS_URL ?? '');
  if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
    decodeURIComponent(redisUrl.password).length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
    throw new TypeError('B3 catalog integration requires a password-authenticated loopback Redis');
  }
  const storageUrl = new URL(process.env.S3_ENDPOINT ?? '');
  const publicBaseUrl = new URL(process.env.S3_PUBLIC_BASE_URL ?? '');
  const bucket = process.env.S3_BUCKET ?? '';
  if (storageUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storageUrl.hostname) ||
    storageUrl.username !== '' || storageUrl.password !== '' || storageUrl.pathname !== '/' ||
    storageUrl.search !== '' || storageUrl.hash !== '' || !bucket.startsWith('mall-b3-') ||
    publicBaseUrl.origin !== storageUrl.origin || publicBaseUrl.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBaseUrl.search !== '' || publicBaseUrl.hash !== '') {
    throw new TypeError('B3 catalog integration requires an isolated loopback mall-b3-* storage configuration');
  }
}

integrationDescribe('B3.2 admin catalog PostgreSQL API integration', () => {
  let app: INestApplication;
  let config: PlatformRuntimeConfig;
  let database: DatabaseRuntime;
  let actorAccountId: string;
  let accessToken: string;
  let brandId: string;
  let categoryId: string;
  let brandCreateKey: string;
  let categoryCreateKey: string;
  let originalBrandResponse: Record<string, unknown>;
  let originalCategoryResponse: Record<string, unknown>;
  let ownedLogoId: string;
  let ownedIconId: string;
  let otherIconId: string;
  let lastPreviewKey: string;

  function authenticated(method: 'get' | 'patch' | 'post', path: string, token = accessToken) {
    return request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function createAuthenticatedActor(label: string): Promise<{ accessToken: string; accountId: string }> {
    const now = new Date();
    const accountId = generateUlid();
    const factorId = generateUlid();
    const sessionId = generateUlid();
    const accessJti = `access:${generateUlid()}`;
    await database.prisma.account.create({
      data: {
        id: accountId,
        login_name: `${label}-${accountId}`.slice(0, 80),
        password_hash: `integration:${sha256(accountId)}`,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });
    await database.prisma.totpFactor.create({
      data: {
        account_id: accountId,
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
        account_id: accountId,
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
    const signed = signAccessToken({
      audience: config.authentication.audience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
      tokenId: accessJti,
    }, config.authentication.accessTokenTtlSeconds);
    return { accessToken: signed.token, accountId };
  }

  async function createPublicFile(
    actorId: string,
    purpose: 'BRAND_LOGO' | 'CATEGORY_ICON',
  ): Promise<string> {
    const id = generateUlid();
    await database.prisma.fileAsset.create({
      data: {
        byte_size: 16n,
        created_by_id: actorId,
        id,
        mime_type: 'image/png',
        object_key: `public/${id}`,
        original_name: `${purpose.toLowerCase()}.png`,
        purpose,
        sha256: sha256(`file:${id}`),
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    return id;
  }

  async function preview(
    targetType: 'brands' | 'categories',
    targetId: string,
    action: 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE',
    reason: string,
  ): Promise<PreviewData> {
    lastPreviewKey = randomUUID();
    const response = await authenticated('post', `/api/v1/admin/${targetType}/${targetId}/lifecycle-preview`)
      .set('Idempotency-Key', lastPreviewKey)
      .send({ action, reason })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
    return response.body.data as PreviewData;
  }

  async function confirm(
    targetType: 'brands' | 'categories',
    targetId: string,
    action: 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE',
    reason: string,
    issued: PreviewData,
    expectedStatus = 200,
  ): Promise<request.Response> {
    return authenticated('post', `/api/v1/admin/${targetType}/${targetId}/lifecycle-changes`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', issued.resource_etag)
      .send({
        action,
        confirmation_hash: issued.confirmation_hash,
        preview_token: issued.preview_token,
        reason,
      })
      .expect(expectedStatus);
  }

  beforeAll(async () => {
    assertFullModeTargets();
    config = loadPlatformConfig(process.env, { service: 'api' });

    Reflect.defineMetadata('design:paramtypes', [Object, Object, AdminLoginRateLimiter], AdminAuthService);
    Reflect.defineMetadata('design:paramtypes', [AdminAuthService], AdminAuthController);
    Reflect.defineMetadata('design:paramtypes', [Object, Object, Object, FileObjectLeaseManager], FileAssetsService);
    Reflect.defineMetadata('design:paramtypes', [FileAssetsService], FilesController);
    Reflect.defineMetadata('design:paramtypes', [Object, Object, Object], AdminCatalogService);
    Reflect.defineMetadata('design:paramtypes', [AdminCatalogService], AdminCatalogController);

    const moduleRef = await Test.createTestingModule({ imports: [ApiRuntimeModule.register(config)] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    database = app.get(API_DATABASE_RUNTIME);

    const actor = await createAuthenticatedActor('B3 catalog integration');
    const otherActor = await createAuthenticatedActor('B3 catalog other actor');
    accessToken = actor.accessToken;
    actorAccountId = actor.accountId;
    ownedLogoId = await createPublicFile(actor.accountId, 'BRAND_LOGO');
    ownedIconId = await createPublicFile(actor.accountId, 'CATEGORY_ICON');
    otherIconId = await createPublicFile(otherActor.accountId, 'CATEGORY_ICON');
  }, 60_000);

  afterAll(async () => app?.close(), 30_000);

  it('creates brand/category drafts, protects file ownership and preserves response envelopes', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/brands').expect(401);

    brandCreateKey = randomUUID();
    const brandResponse = await authenticated('post', '/api/v1/admin/brands')
      .set('Idempotency-Key', brandCreateKey)
      .send({
        description: 'Daily care',
        initial_status: 'DRAFT',
        logo_file_id: ownedLogoId,
        name: `Brand ${generateUlid()}`,
        sort_order: 10,
      })
      .expect(201);
    expect(brandResponse.body).toMatchObject({
      code: 'OK',
      data: { logo_file_id: ownedLogoId, status: 'DRAFT', version: 1 },
      message: 'success',
    });
    expect(brandResponse.body.data.logo_url).toMatch(new RegExp(`/public/${ownedLogoId}$`));
    brandId = String((brandResponse.body.data as CatalogView).brand_id);
    originalBrandResponse = brandResponse.body as Record<string, unknown>;

    categoryCreateKey = randomUUID();
    const categoryResponse = await authenticated('post', '/api/v1/admin/categories')
      .set('Idempotency-Key', categoryCreateKey)
      .send({
        icon_file_id: ownedIconId,
        initial_status: 'DRAFT',
        name: `Category ${generateUlid()}`,
        sort_order: 20,
      })
      .expect(201);
    expect(categoryResponse.body).toMatchObject({
      code: 'OK',
      data: { icon_file_id: ownedIconId, status: 'DRAFT', version: 1 },
      message: 'success',
    });
    categoryId = String((categoryResponse.body.data as CatalogView).category_id);
    originalCategoryResponse = categoryResponse.body as Record<string, unknown>;

    const forbiddenName = `Cross owner ${generateUlid()}`;
    const forbidden = await authenticated('post', '/api/v1/admin/categories')
      .set('Idempotency-Key', randomUUID())
      .send({ icon_file_id: otherIconId, initial_status: 'DRAFT', name: forbiddenName, sort_order: 30 })
      .expect(404);
    expect(forbidden.body.code).toBe('RESOURCE_NOT_FOUND');
    await expect(database.prisma.category.count({ where: { name: forbiddenName } })).resolves.toBe(0);
  });

  it('binds If-Match into idempotency and replays the exact original create bodies after later updates', async () => {
    const brandUpdateKey = randomUUID();
    const brandUpdateBody = { name: `Updated brand ${generateUlid()}`, sort_order: 11 };
    const updatedBrand = await authenticated('patch', `/api/v1/admin/brands/${brandId}`)
      .set('Idempotency-Key', brandUpdateKey)
      .set('If-Match', '"1"')
      .send(brandUpdateBody)
      .expect(200);
    expect(updatedBrand.body.data).toMatchObject({ name: brandUpdateBody.name, version: 2 });
    const originalBrandUpdateResponse = updatedBrand.body;

    const mismatch = await authenticated('patch', `/api/v1/admin/brands/${brandId}`)
      .set('Idempotency-Key', brandUpdateKey)
      .set('If-Match', '"2"')
      .send(brandUpdateBody)
      .expect(409);
    expect(mismatch.body.code).toBe('STATE_CONFLICT');
    const currentBrand = await authenticated('get', `/api/v1/admin/brands/${brandId}`).expect(200);
    expect(currentBrand.body.data.version).toBe(2);

    const changedAgain = await authenticated('patch', `/api/v1/admin/brands/${brandId}`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"2"')
      .send({ description: 'Changed after the original update' })
      .expect(200);
    expect(changedAgain.body.data.version).toBe(3);
    const replayUpdate = await authenticated('patch', `/api/v1/admin/brands/${brandId}`)
      .set('Idempotency-Key', brandUpdateKey)
      .set('If-Match', '"1"')
      .send(brandUpdateBody)
      .expect(200);
    expect(replayUpdate.body).toEqual(originalBrandUpdateResponse);
    const afterReplay = await authenticated('get', `/api/v1/admin/brands/${brandId}`).expect(200);
    expect(afterReplay.body.data.version).toBe(3);

    const replayBrand = await authenticated('post', '/api/v1/admin/brands')
      .set('Idempotency-Key', brandCreateKey)
      .send({
        description: 'Daily care',
        initial_status: 'DRAFT',
        logo_file_id: ownedLogoId,
        name: (originalBrandResponse.data as CatalogView).name,
        sort_order: 10,
      })
      .expect(201);
    expect(replayBrand.body).toEqual(originalBrandResponse);

    const updatedCategory = await authenticated('patch', `/api/v1/admin/categories/${categoryId}`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"1"')
      .send({ sort_order: 21 })
      .expect(200);
    expect(updatedCategory.body.data.version).toBe(2);
    const replayCategory = await authenticated('post', '/api/v1/admin/categories')
      .set('Idempotency-Key', categoryCreateKey)
      .send({
        icon_file_id: ownedIconId,
        initial_status: 'DRAFT',
        name: (originalCategoryResponse.data as CatalogView).name,
        sort_order: 20,
      })
      .expect(201);
    expect(replayCategory.body).toEqual(originalCategoryResponse);
  });

  it('returns dependency impact with 200 and blocks only lifecycle confirmation with 422', async () => {
    const brandActivation = await preview('brands', brandId, 'ACTIVATE', 'Publish brand');
    const activatedBrand = await confirm('brands', brandId, 'ACTIVATE', 'Publish brand', brandActivation);
    expect(activatedBrand.body.data).toMatchObject({ status: 'ACTIVE', version: 4 });

    const categoryActivation = await preview('categories', categoryId, 'ACTIVATE', 'Publish category');
    const activatedCategory = await confirm(
      'categories', categoryId, 'ACTIVATE', 'Publish category', categoryActivation,
    );
    expect(activatedCategory.body.data).toMatchObject({ status: 'ACTIVE', version: 3 });

    await database.prisma.product.create({
      data: {
        brand_id: brandId,
        category_id: categoryId,
        id: generateUlid(),
        name: 'Active dependency',
        published_at: new Date(),
        spu_code: `SPU-${generateUlid()}`,
        status: 'ACTIVE',
      },
    });

    const deactivation = await preview('brands', brandId, 'DEACTIVATE', 'Retire brand');
    expect(deactivation.impact).toMatchObject({
      affected_count: 1,
      warnings: ['ACTIVE_PRODUCT_DEPENDENCY'],
    });
    const blocked = await confirm('brands', brandId, 'DEACTIVATE', 'Retire brand', deactivation, 422);
    expect(blocked.body.code).toBe('ACTIVE_PRODUCT_DEPENDENCY');
    const current = await authenticated('get', `/api/v1/admin/brands/${brandId}`).expect(200);
    expect(current.body.data).toMatchObject({ status: 'ACTIVE', version: 4 });

    const previewRecord = await database.prisma.idempotencyRecord.findFirst({
      where: { actor_id: actorAccountId, idempotency_key: lastPreviewKey },
    });
    expect(previewRecord).not.toBeNull();
    expect(previewRecord?.response_body).toBeNull();
    expect(JSON.stringify(previewRecord)).not.toContain(deactivation.preview_token);
  });

  it('completes a legal lifecycle, archived-only query and restore-to-DRAFT flow', async () => {
    const create = await authenticated('post', '/api/v1/admin/categories')
      .set('Idempotency-Key', randomUUID())
      .send({ initial_status: 'DRAFT', name: `Lifecycle ${generateUlid()}`, sort_order: 40 })
      .expect(201);
    const lifecycleCategoryId = String((create.body.data as CatalogView).category_id);

    const activation = await preview('categories', lifecycleCategoryId, 'ACTIVATE', 'Publish');
    await confirm('categories', lifecycleCategoryId, 'ACTIVATE', 'Publish', activation);
    const deactivation = await preview('categories', lifecycleCategoryId, 'DEACTIVATE', 'Pause');
    await confirm('categories', lifecycleCategoryId, 'DEACTIVATE', 'Pause', deactivation);
    const deletion = await preview('categories', lifecycleCategoryId, 'SOFT_DELETE', 'Retire');
    const archived = await confirm('categories', lifecycleCategoryId, 'SOFT_DELETE', 'Retire', deletion);
    expect(archived.body.data).toMatchObject({ status: 'ARCHIVED', version: 4 });

    const detail = await authenticated('get', `/api/v1/admin/categories/${lifecycleCategoryId}`).expect(200);
    expect(detail.body.data.status).toBe('ARCHIVED');
    const defaultList = await authenticated('get', '/api/v1/admin/categories?page_size=100').expect(200);
    expect((defaultList.body.data.items as CatalogView[])
      .some(({ category_id: itemId }) => itemId === lifecycleCategoryId)).toBe(false);
    const archivedList = await authenticated(
      'get', '/api/v1/admin/categories?status=ARCHIVED&page_size=100',
    ).expect(200);
    expect((archivedList.body.data.items as CatalogView[])
      .some(({ category_id: itemId }) => itemId === lifecycleCategoryId)).toBe(true);

    const restored = await authenticated('post', `/api/v1/admin/categories/${lifecycleCategoryId}/restore`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"4"')
      .send({ reason: 'Resume' })
      .expect(200);
    expect(restored.body.data).toMatchObject({ status: 'DRAFT', version: 5 });
    const restoredDetail = await authenticated(
      'get', `/api/v1/admin/categories/${lifecycleCategoryId}`,
    ).expect(200);
    expect(restoredDetail.body.data).toMatchObject({ status: 'DRAFT', version: 5 });
  });
});
