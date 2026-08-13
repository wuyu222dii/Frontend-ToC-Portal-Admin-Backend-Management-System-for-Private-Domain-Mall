import { describe, expect, it } from 'vitest';

import { loadPlatformConfig } from './index';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const IP_HASH_KEY = Buffer.alloc(32, 9).toString('base64');
const IDEMPOTENCY_HASH_KEY = Buffer.alloc(32, 11).toString('base64');
const PREVIOUS_IDEMPOTENCY_HASH_KEY = Buffer.alloc(32, 13).toString('base64');

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    CI: 'true',
    ALLOW_CI_EPHEMERAL_POSTGRES: '1',
    DATABASE_URL: 'postgresql://mall_runtime:runtime-password@127.0.0.1:5432/mall',
    FIELD_ENCRYPTION_KEY_BASE64: ENCRYPTION_KEY,
    FIELD_ENCRYPTION_KEY_ID: 'test-key-v1',
    AUDIT_IP_HASH_KEY_BASE64: IP_HASH_KEY,
    IDEMPOTENCY_HASH_KEY_BASE64: IDEMPOTENCY_HASH_KEY,
    IDEMPOTENCY_HASH_KEY_ID: 'test-idempotency-v1',
    IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON: '[]',
  };
}

describe('loadPlatformConfig', () => {
  it('loads bounded API and worker defaults', () => {
    const api = loadPlatformConfig(validEnvironment(), { service: 'api' });
    const worker = loadPlatformConfig(validEnvironment(), { service: 'worker' });

    expect(api.port).toBe(3000);
    expect(api.database.poolMax).toBe(10);
    expect(api.database.allowInsecureLocalhost).toBe(true);
    expect(api.database.sslRootCertPath).toBeUndefined();
    expect(api.encryption.idempotencyHashKeys).toEqual({
      current: { id: 'test-idempotency-v1', key: Buffer.alloc(32, 11) },
      previous: [],
    });
    expect(worker.port).toBe(3001);
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
    expect(config.encryption.keyId).toBe('disabled');
    expect(config.encryption.idempotencyHashKeys.current.id).toBe('disabled');
  });
});
