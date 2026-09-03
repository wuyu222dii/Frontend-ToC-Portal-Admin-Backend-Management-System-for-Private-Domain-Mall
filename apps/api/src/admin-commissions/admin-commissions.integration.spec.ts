import { createHash, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import {
  generateUlid,
  signAccessToken,
  signAgentAccessToken,
  signStoreAccessToken,
} from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { RequestIdMiddleware } from '../platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminCommissionsController } from './admin-commissions.controller';
import { AdminCommissionsService } from './admin-commissions.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B134_AGENT_FINANCE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B134_AGENT_FINANCE_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const rollbackSentinel = Object.freeze({ code: 'B134_ADMIN_COMMISSIONS_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 150_000,
};
const signingKeys = {
  current: { id: 'b134-auth-v1', key: Buffer.alloc(32, 0x51) },
  previous: [],
};

interface FixtureIds {
  accountId: string;
  brandId: string;
  categoryId: string;
  factorId: string;
  inheritedSkuId: string;
  productId: string;
  sessionId: string;
  zeroSkuId: string;
}

interface RuleChangeBody {
  configured_rate: string | null;
  target_id: string | null;
  target_type: 'CATEGORY' | 'PLATFORM' | 'SKU';
}

interface RuleActionBody {
  base_version_id: string | null;
  changes: RuleChangeBody[];
  reason: string;
}

interface PreviewData {
  confirmation_hash: string;
  preview_token: string;
  resource_etag: string;
}

interface RuleVersionData {
  base_version_id: string | null;
  changes: RuleChangeBody[];
  status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  version_id: string;
  version_no: number;
}

interface RuleSkuData {
  category_id: string;
  configured_rate: string | null;
  effective_rate: string;
  sku_id: string;
  source: 'CATEGORY' | 'PLATFORM' | 'SKU';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B13.4 Admin commissions integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.4 Admin commissions tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B13.4 Admin commissions DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.4 Admin commissions tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b134-admin-commissions-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.4 Admin commissions tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b134-admin-commissions-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    agent: {
      accessTokenTtlSeconds: 3_600,
      authTokenAudience: 'qingxu-agent-web',
      loginRateLimitMax: 5,
      loginRateLimitWindowSeconds: 900,
      sessionTtlSeconds: 86_400,
    },
    authentication: {
      accessTokenTtlSeconds: 3_600,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-b134-admin-commissions',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: { current: { id: 'b134-secret-v1', key: Buffer.alloc(32, 0x52) }, previous: [] },
      sessionTtlSeconds: 86_400,
      signingKeys,
    },
    encryption: {
      bankAccountHashKeys: { current: { id: 'b134-bank-v1', key: Buffer.alloc(32, 0x53) }, previous: [] },
      fieldKeys: { current: { id: 'b134-field-v1', key: Buffer.alloc(32, 0x54) }, previous: [] },
      idempotencyHashKeys: {
        current: { id: 'b134-idempotency-v1', key: Buffer.alloc(32, 0x55) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 0x56),
    },
    store: { authTokenAudience: 'qingxu-store' },
  } as unknown as PlatformRuntimeConfig;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureIds(): FixtureIds {
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    factorId: generateUlid(),
    inheritedSkuId: generateUlid(),
    productId: generateUlid(),
    sessionId: generateUlid(),
    zeroSkuId: generateUlid(),
  };
}

async function seedFixture(transaction: DatabaseTransaction, fixture: FixtureIds): Promise<void> {
  const now = new Date();
  await transaction.account.create({
    data: {
      id: fixture.accountId,
      login_name: `b134-admin-${fixture.accountId}`.slice(0, 80),
      password_hash: `integration:${digest(fixture.accountId)}`,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  await transaction.totpFactor.create({
    data: {
      account_id: fixture.accountId,
      encryption_key_id: 'b134-field-v1',
      id: fixture.factorId,
      label: 'B13.4 Admin commissions integration',
      secret_ciphertext: Buffer.alloc(32, 0x61),
      secret_fingerprint: digest(`factor:${fixture.factorId}`),
      status: 'ACTIVE',
      verified_at: now,
    },
  });
  await transaction.authSession.create({
    data: {
      access_jti: `access:${fixture.sessionId}`,
      account_id: fixture.accountId,
      assurance: 'MFA',
      expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
      id: fixture.sessionId,
      mfa_factor_id: fixture.factorId,
      mfa_verified_at: now,
      refresh_token_hash: digest(`refresh:${fixture.sessionId}`),
      restriction: 'NONE',
      session_family: generateUlid(),
    },
  });
  await transaction.brand.create({
    data: {
      id: fixture.brandId,
      name: `B13.4 brand ${fixture.brandId}`,
      status: 'ACTIVE',
    },
  });
  await transaction.category.create({
    data: {
      id: fixture.categoryId,
      name: `B13.4 category ${fixture.categoryId}`,
      status: 'ACTIVE',
    },
  });
  await transaction.product.create({
    data: {
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      id: fixture.productId,
      name: `B13.4 product ${fixture.productId}`,
      published_at: now,
      spu_code: `SPU-${fixture.productId}`,
      status: 'ACTIVE',
    },
  });
  await transaction.sku.createMany({
    data: [
      {
        code: `SKU-ZERO-${fixture.zeroSkuId}`,
        id: fixture.zeroSkuId,
        name: 'Explicit zero commission',
        product_id: fixture.productId,
        retail_price: '19.90',
        status: 'ACTIVE',
      },
      {
        code: `SKU-INHERIT-${fixture.inheritedSkuId}`,
        id: fixture.inheritedSkuId,
        name: 'Inherited commission',
        product_id: fixture.productId,
        retail_price: '29.90',
        status: 'ACTIVE',
      },
    ],
  });
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
): DatabaseRuntime {
  const prisma = new Proxy(transaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

async function createTestApplication(
  config: PlatformRuntimeConfig,
  database: DatabaseRuntime,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminCommissionsController],
    providers: [
      AdminCommissionsService,
      { provide: API_RUNTIME_CONFIG, useValue: config },
      { provide: API_DATABASE_RUNTIME, useValue: database },
      { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
      { provide: APP_GUARD, useClass: AuthenticationGuard },
      { provide: APP_GUARD, useClass: RbacGuard },
      { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const requestIds = new RequestIdMiddleware();
  app.use(requestIds.use.bind(requestIds));
  configureApi(app);
  await app.init();
  return app;
}

function adminToken(config: PlatformRuntimeConfig, fixture: FixtureIds): string {
  return signAccessToken({
    audience: config.authentication.audience,
    issuer: config.authentication.issuer,
    keys: config.authentication.signingKeys,
  }, {
    accountId: fixture.accountId,
    assurance: 'MFA',
    permissions: [],
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    sessionId: fixture.sessionId,
    tokenId: `access:${fixture.sessionId}`,
  }, config.authentication.accessTokenTtlSeconds).token;
}

function crossRealmTokens(config: PlatformRuntimeConfig, fixture: FixtureIds): string[] {
  const principal = {
    accountId: fixture.accountId,
    permissions: [],
    restriction: 'NONE' as const,
    sessionId: generateUlid(),
    tokenId: `access:${generateUlid()}`,
  };
  return [
    signAgentAccessToken({
      audience: config.agent.authTokenAudience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      ...principal,
      assurance: 'PASSWORD',
      role: 'AGENT_ADMIN',
    }, config.agent.accessTokenTtlSeconds).token,
    signStoreAccessToken({
      audience: config.store.authTokenAudience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      ...principal,
      assurance: 'WECHAT',
      role: 'CUSTOMER',
    }, config.authentication.accessTokenTtlSeconds).token,
  ];
}

function expectNoStore(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function findSku(items: RuleSkuData[], skuId: string): RuleSkuData {
  const item = items.find(({ sku_id: candidate }) => candidate === skuId);
  if (!item) throw new TypeError(`Commission rule response omitted SKU ${skuId}`);
  return item;
}

integrationDescribe('B13.4 Admin commissions PostgreSQL API integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('authenticates, publishes and replays rules while preserving null inheritance and explicit 0%', async () => {
    const config = integrationConfig();
    const fixture = fixtureIds();
    const previewKeys: [string, string] = [randomUUID(), randomUUID()];
    const publishKeys: [string, string] = [randomUUID(), randomUUID()];
    const createdVersionIds: string[] = [];
    let baselineVersionId: string | null = null;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, fixture);
      const baseline = await transaction.commissionRuleVersion.findFirst({
        orderBy: [{ version_no: 'desc' }, { id: 'desc' }],
        select: { id: true, version_no: true },
        where: { status: 'PUBLISHED' },
      });
      baselineVersionId = baseline?.id ?? null;
      const app = await createTestApplication(config, transactionBoundRuntime(runtime, transaction));
      const bearer = `Bearer ${adminToken(config, fixture)}`;

      try {
        const anonymous = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rules/current')
          .expect(401);
        expect(anonymous.body.code).toBe('AUTH_REQUIRED');
        expectNoStore(anonymous);
        for (const token of crossRealmTokens(config, fixture)) {
          const rejected = await request(app.getHttpServer())
            .get('/api/v1/admin/commission-rules/current')
            .set('Authorization', `Bearer ${token}`)
            .expect(401);
          expect(rejected.body.code).toBe('AUTH_REQUIRED');
          expectNoStore(rejected);
        }

        const firstAction: RuleActionBody = {
          base_version_id: baseline?.id ?? null,
          changes: [
            ...(baseline === null ? [{
              configured_rate: '5.0000',
              target_id: null,
              target_type: 'PLATFORM' as const,
            }] : []),
            {
              configured_rate: '7.5000',
              target_id: fixture.categoryId,
              target_type: 'CATEGORY',
            },
            {
              configured_rate: '0.0000',
              target_id: fixture.zeroSkuId,
              target_type: 'SKU',
            },
          ],
          reason: 'B13.4 publish explicit zero and inherited commission fixtures',
        };
        const firstPreview = await request(app.getHttpServer())
          .post('/api/v1/admin/commission-rule-versions/preview')
          .set('Authorization', bearer)
          .set('Idempotency-Key', previewKeys[0] as string)
          .send(firstAction)
          .expect(200);
        expectNoStore(firstPreview);
        const firstPreviewData = firstPreview.body.data as PreviewData;
        expect(firstPreviewData).toMatchObject({ resource_etag: `"${baseline?.version_no ?? 0}"` });
        expect(firstPreviewData.confirmation_hash).toMatch(/^[a-f0-9]{64}$/);

        const firstConfirmation = {
          ...firstAction,
          confirmation_hash: firstPreviewData.confirmation_hash,
          preview_token: firstPreviewData.preview_token,
        };
        const firstPublish = await request(app.getHttpServer())
          .post('/api/v1/admin/commission-rule-versions')
          .set('Authorization', bearer)
          .set('Idempotency-Key', publishKeys[0] as string)
          .set('If-Match', firstPreviewData.resource_etag)
          .send(firstConfirmation)
          .expect(200);
        expectNoStore(firstPublish);
        const firstVersion = firstPublish.body.data as RuleVersionData;
        createdVersionIds.push(firstVersion.version_id);
        expect(firstVersion).toMatchObject({
          base_version_id: baseline?.id ?? null,
          status: 'PUBLISHED',
        });
        expect(firstVersion.changes).toEqual(expect.arrayContaining([
          expect.objectContaining({
            configured_rate: '7.5000',
            target_id: fixture.categoryId,
            target_type: 'CATEGORY',
          }),
          expect.objectContaining({
            configured_rate: '0.0000',
            target_id: fixture.zeroSkuId,
            target_type: 'SKU',
          }),
        ]));

        const firstReplay = await request(app.getHttpServer())
          .post('/api/v1/admin/commission-rule-versions')
          .set('Authorization', bearer)
          .set('Idempotency-Key', publishKeys[0] as string)
          .set('If-Match', firstPreviewData.resource_etag)
          .send(firstConfirmation)
          .expect(200);
        expect(firstReplay.body.data).toEqual(firstVersion);
        expectNoStore(firstReplay);

        const firstCurrent = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rules/current')
          .set('Authorization', bearer)
          .expect(200);
        expectNoStore(firstCurrent);
        expect(firstCurrent.body.data).toMatchObject({
          version_id: firstVersion.version_id,
          version_no: firstVersion.version_no,
        });
        const firstCategory = (firstCurrent.body.data.categories as Array<Record<string, unknown>>)
          .find(({ category_id: categoryId }) => categoryId === fixture.categoryId);
        expect(firstCategory).toMatchObject({
          configured_rate: '7.5000',
          effective_rate: '7.5000',
          source: 'CATEGORY',
        });

        const firstSkus = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rules/skus')
          .set('Authorization', bearer)
          .query({ category_id: fixture.categoryId, page_size: '100' })
          .expect(200);
        expectNoStore(firstSkus);
        expect(firstSkus.body.data).toMatchObject({
          pagination: { total: 2 },
          version_id: firstVersion.version_id,
          version_no: firstVersion.version_no,
        });
        const firstSkuItems = firstSkus.body.data.items as RuleSkuData[];
        expect(findSku(firstSkuItems, fixture.zeroSkuId)).toMatchObject({
          configured_rate: '0.0000',
          effective_rate: '0.0000',
          source: 'SKU',
        });
        expect(findSku(firstSkuItems, fixture.inheritedSkuId)).toMatchObject({
          configured_rate: null,
          effective_rate: '7.5000',
          source: 'CATEGORY',
        });

        const firstDetail = await request(app.getHttpServer())
          .get(`/api/v1/admin/commission-rule-versions/${firstVersion.version_id}`)
          .set('Authorization', bearer)
          .expect(200);
        expect(firstDetail.body.data).toEqual(firstVersion);
        expectNoStore(firstDetail);

        const secondAction: RuleActionBody = {
          base_version_id: firstVersion.version_id,
          changes: [{
            configured_rate: null,
            target_id: fixture.categoryId,
            target_type: 'CATEGORY',
          }],
          reason: 'B13.4 remove category override without changing explicit zero SKU',
        };
        const secondPreview = await request(app.getHttpServer())
          .post('/api/v1/admin/commission-rule-versions/preview')
          .set('Authorization', bearer)
          .set('Idempotency-Key', previewKeys[1] as string)
          .send(secondAction)
          .expect(200);
        expectNoStore(secondPreview);
        const secondPreviewData = secondPreview.body.data as PreviewData;
        expect(secondPreviewData.resource_etag).toBe(`"${firstVersion.version_no}"`);

        const secondPublish = await request(app.getHttpServer())
          .post('/api/v1/admin/commission-rule-versions')
          .set('Authorization', bearer)
          .set('Idempotency-Key', publishKeys[1] as string)
          .set('If-Match', secondPreviewData.resource_etag)
          .send({
            ...secondAction,
            confirmation_hash: secondPreviewData.confirmation_hash,
            preview_token: secondPreviewData.preview_token,
          })
          .expect(200);
        expectNoStore(secondPublish);
        const secondVersion = secondPublish.body.data as RuleVersionData;
        createdVersionIds.push(secondVersion.version_id);
        expect(secondVersion).toMatchObject({
          base_version_id: firstVersion.version_id,
          status: 'PUBLISHED',
        });
        expect(secondVersion.changes).toEqual([{
          configured_rate: null,
          target_id: fixture.categoryId,
          target_type: 'CATEGORY',
        }]);

        const secondCurrent = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rules/current')
          .set('Authorization', bearer)
          .expect(200);
        expectNoStore(secondCurrent);
        const platformRate = secondCurrent.body.data.platform_rate as string;
        const secondCategory = (secondCurrent.body.data.categories as Array<Record<string, unknown>>)
          .find(({ category_id: categoryId }) => categoryId === fixture.categoryId);
        expect(secondCategory).toMatchObject({
          configured_rate: null,
          effective_rate: platformRate,
          source: 'PLATFORM',
        });

        const secondSkus = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rules/skus')
          .set('Authorization', bearer)
          .query({ category_id: fixture.categoryId, page_size: '100' })
          .expect(200);
        const secondSkuItems = secondSkus.body.data.items as RuleSkuData[];
        expect(findSku(secondSkuItems, fixture.zeroSkuId)).toMatchObject({
          configured_rate: '0.0000',
          effective_rate: '0.0000',
          source: 'SKU',
        });
        expect(findSku(secondSkuItems, fixture.inheritedSkuId)).toMatchObject({
          configured_rate: null,
          effective_rate: platformRate,
          source: 'PLATFORM',
        });

        const versions = await request(app.getHttpServer())
          .get('/api/v1/admin/commission-rule-versions?page_size=100')
          .set('Authorization', bearer)
          .expect(200);
        expectNoStore(versions);
        const versionItems = versions.body.data.items as RuleVersionData[];
        expect(versionItems.find(({ version_id: id }) => id === firstVersion.version_id))
          .toMatchObject({ status: 'ARCHIVED' });
        expect(versionItems.find(({ version_id: id }) => id === secondVersion.version_id))
          .toMatchObject({ status: 'PUBLISHED' });

        const secondDetail = await request(app.getHttpServer())
          .get(`/api/v1/admin/commission-rule-versions/${secondVersion.version_id}`)
          .set('Authorization', bearer)
          .expect(200);
        expect(secondDetail.body.data).toEqual(secondVersion);
        expectNoStore(secondDetail);

        await expect(Promise.all([
          transaction.idempotencyRecord.count({
            where: { actor_id: fixture.accountId, idempotency_key: publishKeys[0] },
          }),
          transaction.auditLog.count({
            where: {
              actor_account_id: fixture.accountId,
              idempotency_key: publishKeys[0],
              object_id: firstVersion.version_id,
            },
          }),
          transaction.outboxEvent.count({
            where: {
              aggregate_id: firstVersion.version_id,
              aggregate_type: 'commission_rule',
              event_type: 'commission_rule.published',
            },
          }),
        ])).resolves.toEqual([1, 1, 1]);
        const replayRecord = await transaction.idempotencyRecord.findFirstOrThrow({
          where: { actor_id: fixture.accountId, idempotency_key: publishKeys[0] },
        });
        expect(replayRecord).toMatchObject({
          resource_id: firstVersion.version_id,
          response_body: null,
          response_status: 200,
        });
        expect(replayRecord.response_body_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(await transaction.highRiskOperationPreview.count({
          where: { action: 'COMMISSION_RULE.PUBLISH', actor_account_id: fixture.accountId },
        })).toBe(2);
        expect(await transaction.highRiskOperationPreview.count({
          where: {
            action: 'COMMISSION_RULE.PUBLISH',
            actor_account_id: fixture.accountId,
            consumed_at: { not: null },
          },
        })).toBe(2);
        throw rollbackSentinel;
      } finally {
        await app.close();
      }
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    expect(createdVersionIds).toHaveLength(2);
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: fixture.accountId } }),
      runtime.prisma.authSession.count({ where: { id: fixture.sessionId } }),
      runtime.prisma.totpFactor.count({ where: { id: fixture.factorId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.sku.count({ where: { id: { in: [fixture.zeroSkuId, fixture.inheritedSkuId] } } }),
      runtime.prisma.commissionRuleVersion.count({ where: { id: { in: createdVersionIds } } }),
      runtime.prisma.idempotencyRecord.count({
        where: { actor_id: fixture.accountId, idempotency_key: { in: [...previewKeys, ...publishKeys] } },
      }),
      runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: { in: createdVersionIds } } }),
      runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (baselineVersionId !== null) {
      await expect(runtime.prisma.commissionRuleVersion.findUnique({
        select: { status: true },
        where: { id: baselineVersionId },
      })).resolves.toMatchObject({ status: 'PUBLISHED' });
    }
  }, 180_000);
});
