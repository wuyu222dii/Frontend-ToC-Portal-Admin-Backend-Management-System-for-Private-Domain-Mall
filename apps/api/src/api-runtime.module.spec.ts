import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { Test } from '@nestjs/testing';
import {
  createEncryptionContext,
  encryptEnvelope,
  generateUlid,
  hmacAuthenticationSecret,
  signAccessToken,
  verifyAccessToken,
} from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminCatalogController } from './admin-catalog/admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog/admin-catalog.service';
import { AdminAuthController } from './admin-auth/admin-auth.controller';
import { AdminLoginRateLimiter } from './admin-auth/admin-login-rate-limiter';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { FileObjectLeaseManager } from './files/file-object-lease';
import { FilesController } from './files/files.controller';
import { FileAssetsService } from './files/files.service';
import { ApiRuntimeModule, API_RUNTIME_CONFIG } from './api-runtime.module';
import { API_DATABASE_RUNTIME } from './platform/database/api-database-runtime';
import { apiRedisReconnectDelay } from './platform/redis/api-redis-runtime';
import { StorePhoneProvider } from './store-profile/store-phone-provider';
import { StoreProfileController } from './store-profile/store-profile.controller';
import { StoreProfileService } from './store-profile/store-profile.service';
import { StoreFavoritesController } from './store-favorites/store-favorites.controller';
import { StoreFavoritesService } from './store-favorites/store-favorites.service';
import { StoreCartController } from './store-cart/store-cart.controller';
import { StoreCartService } from './store-cart/store-cart.service';
import { StoreAddressController } from './store-address/store-address.controller';
import { StoreAddressService } from './store-address/store-address.service';

function runtimeConfig(): PlatformRuntimeConfig {
  const key = (byte: number) => Buffer.alloc(32, byte);
  return {
    banner: { targetOrigins: [] },
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: { current: { id: 'auth-hash-v1', key: key(5) }, previous: [] },
      sessionTtlSeconds: 604_800,
      signingKeys: { current: { id: 'auth-sign-v1', key: key(4) }, previous: [] },
    },
    database: {
      allowInsecureLocalhost: false, connectionTimeoutMs: 5_000,
      poolMax: 10, projectRef: undefined, sslRootCertPath: undefined,
      url: 'postgresql://mall_runtime:password@db.example.test:5432/postgres?sslmode=verify-full',
    },
    encryption: {
      fieldKeys: { current: { id: 'field-v1', key: key(1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: key(3) }, previous: [] },
      ipHashKey: key(2),
    },
    environment: 'test',
    port: 3000,
    redis: { url: 'redis://:runtime-test-password@127.0.0.1:6379/0' },
    service: 'api',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      phoneHashKeys: { current: { id: 'store-phone-v1', key: key(6) }, previous: [] },
      phoneProvider: 'MOCK',
      wechatAppId: 'qingxu-mock-store-app',
      wechatAppSecret: undefined,
      legalDocuments: {
        userAgreement: { version: 'user-v1', title: 'User agreement', url: 'https://example.test/user' },
        privacyPolicy: { version: 'privacy-v1', title: 'Privacy policy', url: 'https://example.test/privacy' },
        phoneAuthorization: { version: 'phone-v1', title: 'Phone notice', url: 'https://example.test/phone' },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      customerRateLimitMax: 120,
      customerRateLimitWindowSeconds: 60,
    },
    storage: {
      accessKey: 'minio-access-key-value', bucket: 'mall-test', endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true, maxUploadBytes: 5_242_880, pendingCleanupAgeSeconds: 86_400,
      privateDownloadTtlSeconds: 300, publicBaseUrl: 'http://127.0.0.1:9000/mall-test',
      region: 'us-east-1', secretKey: 'minio-secret-value', uploadTtlSeconds: 900,
    },
    worker: { baseRetryDelayMs: 1_000, batchSize: 20, maxRetries: 8, pollIntervalMs: 1_000 },
  };
}

describe('ApiRuntimeModule authentication wiring', () => {
  it('uses bounded reconnect delays for transient Redis outages', () => {
    expect([0, 1, 2, 3, 10, Number.MAX_SAFE_INTEGER].map(apiRedisReconnectDelay))
      .toEqual([100, 200, 400, 800, 3_200, 3_200]);
  });

  it('resolves explicit class dependencies without decorator metadata', async () => {
    const database = {
      connect: vi.fn(), disconnect: vi.fn(), ping: vi.fn(),
      prisma: {}, withPgTransaction: vi.fn(), withPrismaTransaction: vi.fn(),
    } as unknown as DatabaseRuntime;
    const moduleRef = await Test.createTestingModule({ imports: [ApiRuntimeModule.register(runtimeConfig())] })
      .overrideProvider(API_DATABASE_RUNTIME).useValue(database)
      .compile();
    expect(moduleRef.get(API_RUNTIME_CONFIG)).toMatchObject({ service: 'api' });
    const authService = moduleRef.get(AdminAuthService);
    const fileService = moduleRef.get(FileAssetsService);
    expect(authService).toHaveProperty('loginRateLimiter', moduleRef.get(AdminLoginRateLimiter));
    expect(moduleRef.get(AdminAuthController)).toHaveProperty('auth', authService);
    expect(moduleRef.get(AdminCatalogController)).toHaveProperty('catalog', moduleRef.get(AdminCatalogService));
    expect(moduleRef.get(FilesController)).toHaveProperty('files', fileService);
    expect(fileService).toHaveProperty('leases', moduleRef.get(FileObjectLeaseManager));
    const profileService = moduleRef.get(StoreProfileService);
    expect(profileService).toHaveProperty('phoneProvider', moduleRef.get(StorePhoneProvider));
    expect(moduleRef.get(StoreProfileController)).toHaveProperty('profiles', profileService);
    expect(moduleRef.get(StoreFavoritesController)).toHaveProperty(
      'favorites',
      moduleRef.get(StoreFavoritesService),
    );
    expect(moduleRef.get(StoreCartController)).toHaveProperty('cart', moduleRef.get(StoreCartService));
    expect(moduleRef.get(StoreAddressController)).toHaveProperty(
      'addresses',
      moduleRef.get(StoreAddressService),
    );
    await moduleRef.close();
  });

  it('decrypts a TOTP envelope with a retained previous field key', () => {
    const config = runtimeConfig();
    const previousKey = config.encryption.fieldKeys.current;
    config.encryption.fieldKeys = {
      current: { id: 'field-v2', key: Buffer.alloc(32, 8) },
      previous: [previousKey],
    };
    const database = { prisma: {} } as DatabaseRuntime;
    const service = new AdminAuthService(config, database);
    const factorId = generateUlid();
    const context = createEncryptionContext('totp_factor', factorId, 'secret_ciphertext');
    const envelope = encryptEnvelope('NONPRODUCTIONBASE32', {
      keyId: previousKey.id,
      key: previousKey.key,
    }, context);
    const decrypt = service as unknown as {
      decryptFactorSecret(id: string, ciphertext: Uint8Array, keyId: string): string;
    };

    expect(decrypt.decryptFactorSecret(
      factorId,
      Buffer.from(JSON.stringify(envelope), 'utf8'),
      previousKey.id,
    )).toBe('NONPRODUCTIONBASE32');
  });

  it('verifies authentication artifacts with retained previous keys', () => {
    const config = runtimeConfig();
    const previousSigningKey = config.authentication.signingKeys.current;
    const previousSecretHashKey = config.authentication.secretHashKeys.current;
    config.authentication.signingKeys = {
      current: { id: 'auth-sign-v2', key: Buffer.alloc(32, 9) },
      previous: [previousSigningKey],
    };
    config.authentication.secretHashKeys = {
      current: { id: 'auth-hash-v2', key: Buffer.alloc(32, 10) },
      previous: [previousSecretHashKey],
    };
    const legacyToken = signAccessToken({
      audience: config.authentication.audience,
      issuer: config.authentication.issuer,
      keys: { current: previousSigningKey, previous: [] },
    }, {
      accountId: '01J00000000000000000000000',
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: '01J00000000000000000000001',
      tokenId: '01J00000000000000000000002',
    }, 900);
    expect(verifyAccessToken({
      audience: config.authentication.audience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, legacyToken.token)).toMatchObject({ accountId: '01J00000000000000000000000' });

    const service = new AdminAuthService(config, { prisma: {} } as DatabaseRuntime);
    const hashes = (service as unknown as {
      secretHashes(value: string, domain: 'refresh-token'): readonly string[];
    }).secretHashes('rfr_non-production-legacy-token', 'refresh-token');
    expect(hashes).toContain(hmacAuthenticationSecret(
      'rfr_non-production-legacy-token',
      previousSecretHashKey.key,
      'refresh-token',
    ));
  });
});
