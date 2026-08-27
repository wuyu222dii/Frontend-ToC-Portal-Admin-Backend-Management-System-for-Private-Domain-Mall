import { describe, expect, it } from 'vitest';

import { loadPlatformConfig } from './index';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const IP_HASH_KEY = Buffer.alloc(32, 9).toString('base64');
const IDEMPOTENCY_HASH_KEY = Buffer.alloc(32, 11).toString('base64');
const PREVIOUS_IDEMPOTENCY_HASH_KEY = Buffer.alloc(32, 13).toString('base64');
const AUTH_SIGNING_KEY = Buffer.alloc(32, 17).toString('base64');
const AUTH_SECRET_HASH_KEY = Buffer.alloc(32, 19).toString('base64');
const STORE_PHONE_HASH_KEY = Buffer.alloc(32, 21).toString('base64');

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    CI: 'true',
    ALLOW_CI_EPHEMERAL_POSTGRES: '1',
    DATABASE_URL: 'postgresql://mall_runtime:runtime-password@127.0.0.1:5432/mall',
    REDIS_URL: 'redis://:local-redis-password@127.0.0.1:6379/0',
    S3_ACCESS_KEY: 'local-minio-access-key',
    S3_BUCKET: 'mall-test',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/mall-test',
    S3_REGION: 'us-east-1',
    S3_SECRET_KEY: 'local-minio-secret-value',
    FIELD_ENCRYPTION_KEY_BASE64: ENCRYPTION_KEY,
    FIELD_ENCRYPTION_KEY_ID: 'test-key-v1',
    FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON: '[]',
    AUDIT_IP_HASH_KEY_BASE64: IP_HASH_KEY,
    IDEMPOTENCY_HASH_KEY_BASE64: IDEMPOTENCY_HASH_KEY,
    IDEMPOTENCY_HASH_KEY_ID: 'test-idempotency-v1',
    IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON: '[]',
    AUTH_SIGNING_KEY_BASE64: AUTH_SIGNING_KEY,
    AUTH_SIGNING_KEY_ID: 'test-auth-sign-v1',
    AUTH_PREVIOUS_SIGNING_KEYS_JSON: '[]',
    AUTH_SECRET_HASH_KEY_BASE64: AUTH_SECRET_HASH_KEY,
    AUTH_SECRET_HASH_KEY_ID: 'test-auth-secret-v1',
    AUTH_PREVIOUS_SECRET_HASH_KEYS_JSON: '[]',
    AUTH_TOKEN_ISSUER: 'qingxu-api-test',
    AUTH_TOKEN_AUDIENCE: 'qingxu-admin-test',
    STORE_AUTH_TOKEN_AUDIENCE: 'qingxu-store',
    STORE_IDENTITY_PROVIDER: 'MOCK',
    STORE_PHONE_PROVIDER: 'MOCK',
    STORE_PHONE_HASH_KEY_BASE64: STORE_PHONE_HASH_KEY,
    STORE_PHONE_HASH_KEY_ID: 'test-store-phone-v1',
    STORE_PHONE_PREVIOUS_HASH_KEYS_JSON: '[]',
    STORE_WECHAT_APP_ID: 'qingxu-mock-store-app',
    STORE_USER_AGREEMENT_VERSION: 'user-v1',
    STORE_USER_AGREEMENT_TITLE: 'User agreement',
    STORE_USER_AGREEMENT_URL: 'https://example.invalid/legal/user-v1',
    STORE_PRIVACY_POLICY_VERSION: 'privacy-v1',
    STORE_PRIVACY_POLICY_TITLE: 'Privacy policy',
    STORE_PRIVACY_POLICY_URL: 'https://example.invalid/legal/privacy-v1',
    STORE_PHONE_AUTHORIZATION_VERSION: 'phone-v1',
    STORE_PHONE_AUTHORIZATION_TITLE: 'Phone authorization',
    STORE_PHONE_AUTHORIZATION_URL: 'https://example.invalid/legal/phone-v1',
    STORE_LEGAL_RATE_LIMIT_MAX: '120',
    STORE_LEGAL_RATE_LIMIT_WINDOW_SECONDS: '60',
    STORE_LOGIN_RATE_LIMIT_MAX: '10',
    STORE_LOGIN_RATE_LIMIT_WINDOW_SECONDS: '900',
  };
}

describe('loadPlatformConfig', () => {
  it('loads bounded API and worker defaults', () => {
    const api = loadPlatformConfig(validEnvironment(), { service: 'api' });
    const worker = loadPlatformConfig(validEnvironment(), { service: 'worker' });

    expect(api.port).toBe(3000);
    expect(api.http).toEqual({ trustedProxyCidrs: [] });
    expect(api.banner.targetOrigins).toEqual([]);
    expect(api.database.poolMax).toBe(10);
    expect(api.database.allowInsecureLocalhost).toBe(true);
    expect(api.database.sslRootCertPath).toBeUndefined();
    expect(api.redis.url).toBe('redis://:local-redis-password@127.0.0.1:6379/0');
    expect(api.storage).toEqual({
      accessKey: 'local-minio-access-key',
      bucket: 'mall-test',
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      maxUploadBytes: 5_242_880,
      pendingCleanupAgeSeconds: 86_400,
      privateDownloadTtlSeconds: 300,
      publicBaseUrl: 'http://127.0.0.1:9000/mall-test',
      region: 'us-east-1',
      secretKey: 'local-minio-secret-value',
      uploadTtlSeconds: 900,
    });
    expect(api.encryption.fieldKeys).toEqual({
      current: { id: 'test-key-v1', key: Buffer.alloc(32, 7) },
      previous: [],
    });
    expect(api.encryption.idempotencyHashKeys).toEqual({
      current: { id: 'test-idempotency-v1', key: Buffer.alloc(32, 11) },
      previous: [],
    });
    expect(api.authentication).toMatchObject({
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-test',
      issuer: 'qingxu-api-test',
      preAuthTokenTtlSeconds: 300,
      sessionTtlSeconds: 604_800,
      signingKeys: { current: { id: 'test-auth-sign-v1', key: Buffer.alloc(32, 17) }, previous: [] },
      secretHashKeys: { current: { id: 'test-auth-secret-v1', key: Buffer.alloc(32, 19) }, previous: [] },
    });
    expect(api.store).toEqual({
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      phoneHashKeys: {
        current: { id: 'test-store-phone-v1', key: Buffer.alloc(32, 21) },
        previous: [],
      },
      phoneProvider: 'MOCK',
      wechatAppId: 'qingxu-mock-store-app',
      wechatAppSecret: undefined,
      legalDocuments: {
        userAgreement: {
          version: 'user-v1', title: 'User agreement', url: 'https://example.invalid/legal/user-v1',
        },
        privacyPolicy: {
          version: 'privacy-v1', title: 'Privacy policy', url: 'https://example.invalid/legal/privacy-v1',
        },
        phoneAuthorization: {
          version: 'phone-v1', title: 'Phone authorization', url: 'https://example.invalid/legal/phone-v1',
        },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
    });
    expect(worker.port).toBe(3001);
    expect(worker.http).toEqual({ trustedProxyCidrs: [] });
    expect(worker.database.poolMax).toBe(5);
    expect(worker.worker).toEqual({
      pollIntervalMs: 1_000,
      batchSize: 20,
      maxRetries: 8,
      baseRetryDelayMs: 1_000,
    });
  });

  it('rejects a migrator connection at runtime', () => {
    const environment = validEnvironment();
    environment.DATABASE_URL = 'postgresql://mall_migrator:migrator-password@127.0.0.1:5432/mall';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL must authenticate as mall_runtime',
    );
  });

  it('rejects a Supabase API key disguised as a connection value', () => {
    const environment = validEnvironment();
    environment.DATABASE_URL =
      'postgresql://mall_runtime:service_role-secret@127.0.0.1:5432/mall';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL must not contain a Supabase API key',
    );
  });

  it('rejects an unapproved local database outside the explicit CI test boundary', () => {
    const environment = validEnvironment();
    environment.CI = 'false';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'local PostgreSQL is allowed only for the explicit ephemeral CI test database',
    );
  });

  it('requires the approved Supabase project, direct/session port and verified TLS', () => {
    const environment = validEnvironment();
    environment.NODE_ENV = 'development';
    environment.CI = 'false';
    environment.ALLOW_CI_EPHEMERAL_POSTGRES = '0';
    environment.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
    environment.DATABASE_URL =
      'postgresql://mall_runtime.abcdefghijklmnopqrst:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL must contain exactly one sslmode parameter',
    );

    environment.DATABASE_URL += '?sslmode=verify-full';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL requires an explicit trusted CA path',
    );

    environment.PGSSLROOTCERT = '/run/secrets/supabase-ca.crt';
    const config = loadPlatformConfig(environment, { service: 'api' });
    expect(config.database.url).toBe(environment.DATABASE_URL);
    expect(config.database.projectRef).toBe('abcdefghijklmnopqrst');
    expect(config.database.sslRootCertPath).toBe('/run/secrets/supabase-ca.crt');
    expect(config.database.allowInsecureLocalhost).toBe(false);
  });

  it('rejects conflicting trusted CA paths', () => {
    const environment = validEnvironment();
    environment.NODE_ENV = 'development';
    environment.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
    environment.DATABASE_URL =
      'postgresql://mall_runtime.abcdefghijklmnopqrst:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=%2Furl%2Fca.crt';
    environment.PGSSLROOTCERT = '/environment/ca.crt';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL sslrootcert must match PGSSLROOTCERT',
    );
  });

  it('rejects duplicate TLS parameters even when the first value is secure', () => {
    const environment = validEnvironment();
    environment.NODE_ENV = 'development';
    environment.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
    environment.PGSSLROOTCERT = '/run/secrets/supabase-ca.crt';
    environment.DATABASE_URL =
      'postgresql://mall_runtime.abcdefghijklmnopqrst:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslmode=disable';

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL must contain exactly one sslmode parameter',
    );

    environment.DATABASE_URL =
      'postgresql://mall_runtime.abcdefghijklmnopqrst:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=%2Frun%2Fsecrets%2Fsupabase-ca.crt&sslrootcert=%2Ftmp%2Fevil.crt';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'DATABASE_URL must not repeat sslrootcert',
    );
  });

  it('rejects query parameters that can override the approved database target', () => {
    const environment = validEnvironment();
    environment.NODE_ENV = 'development';
    environment.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
    environment.PGSSLROOTCERT = '/run/secrets/supabase-ca.crt';
    const base =
      'postgresql://mall_runtime.abcdefghijklmnopqrst:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';

    for (const override of ['host=evil.example', 'user=postgres', 'options=-c%20search_path%3Devil']) {
      environment.DATABASE_URL = `${base}&${override}`;
      expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
        'DATABASE_URL contains an unsupported query parameter',
      );
    }
  });

  it('rejects unbounded worker tuning', () => {
    const environment = validEnvironment();
    environment.WORKER_BATCH_SIZE = '101';

    expect(() => loadPlatformConfig(environment, { service: 'worker' })).toThrow(
      'WORKER_BATCH_SIZE must be between 1 and 100',
    );
  });

  it('rejects malformed or short encryption material', () => {
    const environment = validEnvironment();
    environment.FIELD_ENCRYPTION_KEY_BASE64 = Buffer.alloc(16).toString('base64');

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'FIELD_ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes',
    );
  });

  it('retains previous field-encryption keys for envelope decryption', () => {
    const environment = validEnvironment();
    environment.FIELD_ENCRYPTION_KEY_ID = 'test-key-v2';
    environment.FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON = JSON.stringify([{
      id: 'test-key-v1',
      key_base64: Buffer.alloc(32, 29).toString('base64'),
    }]);

    expect(loadPlatformConfig(environment, { service: 'api' }).encryption.fieldKeys).toEqual({
      current: { id: 'test-key-v2', key: Buffer.alloc(32, 7) },
      previous: [{ id: 'test-key-v1', key: Buffer.alloc(32, 29) }],
    });
  });

  it.each([
    undefined,
    'not-json',
    '{}',
    JSON.stringify([{ id: 'test-key-v1' }]),
    JSON.stringify([{ id: 'test-key-v1', key_base64: ENCRYPTION_KEY }]),
  ])('rejects an unsafe field-encryption rotation ring: %s', (previousKeys) => {
    const environment = validEnvironment();
    if (previousKeys === undefined) delete environment.FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON;
    else environment.FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON = previousKeys;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow();
  });

  it('requires authenticated Redis and TLS for non-local endpoints', () => {
    const environment = validEnvironment();
    environment.REDIS_URL = 'redis://cache.example.test:6379/0';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'REDIS_URL requires a host and a password of at least 12 characters',
    );

    environment.REDIS_URL = 'redis://:remote-redis-password@cache.example.test:6379/0';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'Remote and production REDIS_URL values must use rediss',
    );

    environment.REDIS_URL = 'rediss://:remote-redis-password@cache.example.test:6380/0';
    expect(loadPlatformConfig(environment, { service: 'api' }).redis.url).toBe(environment.REDIS_URL);
  });

  it('allows password-authenticated loopback IPv6 Redis in non-production CI', () => {
    const environment = validEnvironment();
    environment.REDIS_URL = 'redis://:local-redis-password@[::1]:6379/0';

    expect(loadPlatformConfig(environment, { service: 'api' }).redis.url).toBe(environment.REDIS_URL);
  });

  it('rejects Redis query parameters and fragments', () => {
    const environment = validEnvironment();
    for (const suffix of ['?tls=false', '#credentials']) {
      environment.REDIS_URL = `redis://:local-redis-password@127.0.0.1:6379/0${suffix}`;
      expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
        'REDIS_URL must not contain query parameters or a fragment',
      );
    }
  });

  it('rejects unsafe object storage endpoints and credentials', () => {
    const environment = validEnvironment();
    environment.S3_ENDPOINT = 'http://storage.example.test';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'Remote and production S3_ENDPOINT values must use HTTPS',
    );

    environment.S3_ENDPOINT = 'http://127.0.0.1:9000/tenant';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'S3_ENDPOINT must be an origin without a path',
    );

    environment.S3_ENDPOINT = 'http://127.0.0.1:9000';
    environment.S3_ACCESS_KEY = 'short';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'S3_ACCESS_KEY has an invalid format',
    );

    environment.S3_ACCESS_KEY = 'local-minio-access-key';
    environment.S3_SECRET_KEY = 'short';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'S3_SECRET_KEY must contain between 16 and 256 printable characters',
    );
  });

  it('requires an explicit stable public object base URL', () => {
    const environment = validEnvironment();
    delete environment.S3_PUBLIC_BASE_URL;
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'S3_PUBLIC_BASE_URL is required',
    );

    environment.S3_PUBLIC_BASE_URL = 'http://127.0.0.1:9000/another-bucket';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'S3_PUBLIC_BASE_URL path must identify S3_BUCKET',
    );
  });

  it('loads only canonical HTTPS Banner target origins', () => {
    const environment = validEnvironment();
    environment.BANNER_TARGET_ORIGINS = 'https://mall.example.test,https://content.example.test:8443';

    expect(loadPlatformConfig(environment, { service: 'api' }).banner.targetOrigins).toEqual([
      'https://mall.example.test',
      'https://content.example.test:8443',
    ]);
  });

  it('normalizes trusted proxy IPv4, IPv6, and IPv4-mapped addresses', () => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = [
      ' 192.0.2.1 ',
      '10.0.0.0/08',
      '2001:0DB8:0000:0000:0000:0000:0000:0000/32',
      '::FFFF:192.0.2.128',
      '::ffff:c000:0200/120',
    ].join(',');

    expect(loadPlatformConfig(environment, { service: 'api' }).http).toEqual({
      trustedProxyCidrs: [
        '192.0.2.1/32',
        '10.0.0.0/8',
        '2001:db8::/32',
        '192.0.2.128/32',
        '192.0.2.0/24',
      ],
    });
  });

  it.each(['', '   '])('treats an empty trusted proxy allowlist as disabled', (entries) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entries;

    expect(loadPlatformConfig(environment, { service: 'api' }).http).toEqual({
      trustedProxyCidrs: [],
    });
  });

  it.each([
    'proxy.example.test',
    '[::1]',
    'fe80::1%en0',
    '192.0.2',
    '192.0.2.1/32/1',
    '192.0.2.1 /32',
    '192.0.2.1/+32',
  ])('rejects a malformed trusted proxy entry: %s', (entry) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entry;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS',
    );
  });

  it.each([
    '0.0.0.0/33',
    '::/129',
    '0.0.0.0/-1',
  ])('rejects an out-of-range trusted proxy prefix: %s', (entry) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entry;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS',
    );
  });

  it.each([
    '0.0.0.0/0',
    '::/0',
    '::ffff:0.0.0.0/96',
  ])('rejects a trusted proxy range that covers every source: %s', (entry) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entry;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS must not trust every source address',
    );
  });

  it.each([
    '192.0.2.1/24',
    '2001:db8::1/64',
    '::ffff:192.0.2.1/120',
  ])('rejects a trusted proxy CIDR with host bits set: %s', (entry) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entry;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS CIDRs must use a network address',
    );
  });

  it.each([
    '192.0.2.1,192.0.2.1/32',
    '192.0.2.1,::ffff:192.0.2.1',
    '192.0.2.0/24,::ffff:192.0.2.0/120',
    '2001:0DB8::/32,2001:db8:0:0:0:0:0:0/32',
  ])('rejects semantic duplicate trusted proxy CIDRs: %s', (entries) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entries;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS must not contain semantic duplicates',
    );
  });

  it.each([
    ',192.0.2.1',
    '192.0.2.1,',
    '192.0.2.1,,198.51.100.1',
  ])('rejects an empty trusted proxy allowlist entry: %s', (entries) => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = entries;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS must contain between 1 and 20 entries',
    );
  });

  it('bounds trusted proxy allowlist count and input lengths', () => {
    const environment = validEnvironment();
    environment.API_TRUSTED_PROXY_CIDRS = Array.from(
      { length: 21 },
      (_, index) => `192.0.2.${index}`,
    ).join(',');
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS must contain between 1 and 20 entries',
    );

    environment.API_TRUSTED_PROXY_CIDRS = '1'.repeat(65);
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS entries must not exceed 64 characters',
    );

    environment.API_TRUSTED_PROXY_CIDRS = ' '.repeat(2_049);
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'API_TRUSTED_PROXY_CIDRS is too long',
    );
  });

  it.each([
    'http://mall.example.test',
    'https://mall.example.test/path',
    'https://user@mall.example.test',
    'https://mall.example.test/',
    'https://mall.example.test,,https://content.example.test',
    'https://mall.example.test,https://mall.example.test',
  ])('rejects an unsafe Banner target origin allowlist: %s', (origins) => {
    const environment = validEnvironment();
    environment.BANNER_TARGET_ORIGINS = origins;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow('BANNER_TARGET_ORIGINS');
  });

  it('rejects reusing the field encryption key for IP hashing', () => {
    const environment = validEnvironment();
    environment.AUDIT_IP_HASH_KEY_BASE64 = environment.FIELD_ENCRYPTION_KEY_BASE64;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'field encryption, audit IP hashing, and idempotency hashing require independent keys',
    );
  });

  it('rejects reusing the idempotency HMAC key for another purpose', () => {
    const environment = validEnvironment();
    environment.IDEMPOTENCY_HASH_KEY_BASE64 = environment.AUDIT_IP_HASH_KEY_BASE64;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'field encryption, audit IP hashing, and idempotency hashing require independent keys',
    );
  });

  it('requires independent authentication signing and secret hashing keys', () => {
    const environment = validEnvironment();
    environment.AUTH_SECRET_HASH_KEY_BASE64 = environment.AUTH_SIGNING_KEY_BASE64;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'all authentication, encryption, audit, and idempotency keys must be independent',
    );
  });

  it('requires the Store phone HMAC key ring to be independent', () => {
    const environment = validEnvironment();
    environment.STORE_PHONE_HASH_KEY_BASE64 = environment.AUTH_SECRET_HASH_KEY_BASE64;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'all authentication, encryption, audit, and idempotency keys must be independent',
    );
  });

  it('loads bounded authentication key rings and token lifetimes', () => {
    const environment = validEnvironment();
    environment.AUTH_SIGNING_KEY_ID = 'test-auth-sign-v2';
    environment.AUTH_PREVIOUS_SIGNING_KEYS_JSON = JSON.stringify([{
      id: 'test-auth-sign-v1',
      key_base64: Buffer.alloc(32, 23).toString('base64'),
    }]);
    environment.AUTH_ACCESS_TOKEN_TTL_SECONDS = '1200';

    const authentication = loadPlatformConfig(environment, { service: 'api' }).authentication;
    expect(authentication.accessTokenTtlSeconds).toBe(1200);
    expect(authentication.signingKeys.previous).toEqual([
      { id: 'test-auth-sign-v1', key: Buffer.alloc(32, 23) },
    ]);
  });

  it('rejects invalid authentication identifiers and token lifetimes', () => {
    const environment = validEnvironment();
    environment.AUTH_TOKEN_AUDIENCE = 'contains spaces';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'AUTH_TOKEN_AUDIENCE has an invalid format',
    );

    environment.AUTH_TOKEN_AUDIENCE = 'qingxu-admin-test';
    environment.AUTH_PREAUTH_TOKEN_TTL_SECONDS = '301';
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'AUTH_PREAUTH_TOKEN_TTL_SECONDS must be between 60 and 300',
    );
  });

  it('rejects Store authentication realm drift and production Mock providers', () => {
    const sharedAudience = validEnvironment();
    sharedAudience.AUTH_TOKEN_AUDIENCE = 'qingxu-store';
    expect(() => loadPlatformConfig(sharedAudience, { service: 'api' })).toThrow(
      'STORE_AUTH_TOKEN_AUDIENCE must differ from AUTH_TOKEN_AUDIENCE',
    );

    const productionMock = validEnvironment();
    productionMock.NODE_ENV = 'production';
    delete productionMock.DATABASE_URL;
    delete productionMock.REDIS_URL;
    delete productionMock.S3_ENDPOINT;
    delete productionMock.S3_PUBLIC_BASE_URL;
    expect(() => loadPlatformConfig(productionMock, {
      service: 'api', requireDatabase: false, requireStorage: false,
    })).toThrow('STORE_IDENTITY_PROVIDER=MOCK is forbidden in production');
  });

  it('requires WeChat credentials only when a Store WeChat provider is selected', () => {
    const environment = validEnvironment();
    environment.STORE_IDENTITY_PROVIDER = 'WECHAT';
    delete environment.STORE_WECHAT_APP_SECRET;
    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow(
      'STORE_WECHAT_APP_SECRET must contain between 16 and 256 characters',
    );

    environment.STORE_WECHAT_APP_SECRET = 'development-secret-value';
    expect(loadPlatformConfig(environment, { service: 'api' }).store.identityProvider).toBe('WECHAT');
  });

  it('requires HTTPS legal documents and the frozen Store rate limits', () => {
    const insecureDocument = validEnvironment();
    insecureDocument.STORE_PRIVACY_POLICY_URL = 'http://example.invalid/privacy';
    expect(() => loadPlatformConfig(insecureDocument, { service: 'api' })).toThrow(
      'STORE_PRIVACY_POLICY_URL must be a credential-free HTTPS URL',
    );

    const driftedLimit = validEnvironment();
    driftedLimit.STORE_LOGIN_RATE_LIMIT_MAX = '11';
    expect(() => loadPlatformConfig(driftedLimit, { service: 'api' })).toThrow(
      'Store legal and login rate limits must match the CH-016 fixed values',
    );
  });

  it('loads a bounded idempotency HMAC rotation ring', () => {
    const environment = validEnvironment();
    environment.IDEMPOTENCY_HASH_KEY_ID = 'test-idempotency-v2';
    environment.IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON = JSON.stringify([{
      id: 'test-idempotency-v1',
      key_base64: PREVIOUS_IDEMPOTENCY_HASH_KEY,
    }]);

    expect(loadPlatformConfig(environment, { service: 'api' }).encryption.idempotencyHashKeys)
      .toEqual({
        current: { id: 'test-idempotency-v2', key: Buffer.alloc(32, 11) },
        previous: [{ id: 'test-idempotency-v1', key: Buffer.alloc(32, 13) }],
      });
  });

  it.each([
    undefined,
    'not-json',
    '{}',
    JSON.stringify([{ id: 'test-idempotency-v1' }]),
    JSON.stringify([{ id: 'test-idempotency-v1', key_base64: IDEMPOTENCY_HASH_KEY }]),
  ])('rejects an unsafe idempotency HMAC rotation ring: %s', (previousKeys) => {
    const environment = validEnvironment();
    if (previousKeys === undefined) delete environment.IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON;
    else environment.IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON = previousKeys;

    expect(() => loadPlatformConfig(environment, { service: 'api' })).toThrow();
  });

  it('allows build-time validation without infrastructure secrets', () => {
    const config = loadPlatformConfig(
      { NODE_ENV: 'development' },
      { service: 'api', requireDatabase: false, requireEncryption: false },
    );

    expect(config.database.url).toBe('');
    expect(config.database.allowInsecureLocalhost).toBe(false);
    expect(config.encryption.fieldKeys.current.id).toBe('disabled');
    expect(config.encryption.idempotencyHashKeys.current.id).toBe('disabled');
    expect(config.redis.url).toBe('');
    expect(config.storage).toMatchObject({ bucket: '', endpoint: '', publicBaseUrl: '' });
  });
});
