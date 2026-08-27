import {
  loadPlatformConfig,
  type PlatformRuntimeConfig,
} from '@qingxu/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertStorePhoneHashMaintenanceInvocation,
  maintainStorePhoneHashes,
  STORE_PHONE_HASH_DRAIN_APPROVAL,
  STORE_PHONE_HASH_MAINTENANCE_MODES,
  storePhoneHashMaintenancePoolConfig,
} from './store-phone-hash-maintenance.cli';

vi.mock('@qingxu/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@qingxu/config')>(),
  loadPlatformConfig: vi.fn(),
}));

const PROJECT_REF = 'abcdefghijklmnopqrst';

function localConfig(overrides: Partial<PlatformRuntimeConfig['database']> = {}): PlatformRuntimeConfig {
  return {
    database: {
      allowInsecureLocalhost: true,
      connectionTimeoutMs: 5_000,
      poolMax: 1,
      projectRef: undefined,
      sslRootCertPath: undefined,
      url: 'postgresql://mall_runtime:runtime-test-password@127.0.0.1:5432/qingxu_test',
      ...overrides,
    },
  } as unknown as PlatformRuntimeConfig;
}

function remoteConfig(): PlatformRuntimeConfig {
  return localConfig({
    allowInsecureLocalhost: false,
    projectRef: PROJECT_REF,
    sslRootCertPath: '/approved/ca.crt',
    url: `postgresql://mall_runtime.${PROJECT_REF}:runtime-test-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  });
}

function invocation(mode: string | undefined, approval = STORE_PHONE_HASH_DRAIN_APPROVAL): NodeJS.ProcessEnv {
  return {
    STORE_PHONE_HASH_DRAIN_OLD_WRITERS_APPROVAL: approval,
    ...(mode === undefined ? {} : { STORE_PHONE_HASH_MAINTENANCE_MODE: mode }),
  };
}

describe('Store phone HMAC maintenance CLI', () => {
  beforeEach(() => vi.mocked(loadPlatformConfig).mockReset());

  it('accepts only approved closed modes with no command-line arguments', () => {
    expect(assertStorePhoneHashMaintenanceInvocation(
      ['node', 'maintenance.cli.ts'],
      invocation(STORE_PHONE_HASH_MAINTENANCE_MODES.REHASH_AND_VERIFY),
    )).toBe('REHASH_AND_VERIFY');
    expect(assertStorePhoneHashMaintenanceInvocation(
      ['node', 'maintenance.cli.ts'],
      invocation(STORE_PHONE_HASH_MAINTENANCE_MODES.VERIFY_CURRENT),
    )).toBe('VERIFY_CURRENT');

    expect(() => assertStorePhoneHashMaintenanceInvocation(
      ['node', 'maintenance.cli.ts'],
      invocation('REHASH_AND_VERIFY', ''),
    )).toThrow('requires drain-old-writers approval');
    expect(() => assertStorePhoneHashMaintenanceInvocation(
      ['node', 'maintenance.cli.ts'],
      invocation('VERIFY_PREVIOUS'),
    )).toThrow('mode is invalid');
    expect(() => assertStorePhoneHashMaintenanceInvocation(
      ['node', 'maintenance.cli.ts', '--force'],
      invocation('REHASH_AND_VERIFY'),
    )).toThrow('does not accept arguments');
  });

  it('accepts only a query-free local mall_migrator URL for the same database', () => {
    const valid = storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: 'postgresql://mall_migrator:migrator-test-password@127.0.0.1:5432/qingxu_test',
    }, localConfig());
    expect(valid).toMatchObject({
      application_name: 'qingxu-store-phone-hash-maintenance',
      connectionTimeoutMillis: 5_000,
      max: 1,
    });

    for (const directUrl of [
      'postgresql://mall_runtime:runtime-test-password@127.0.0.1:5432/qingxu_test',
      'postgresql://mall_migrator:migrator-test-password@127.0.0.1:5432/another_test',
      'postgresql://mall_migrator:migrator-test-password@127.0.0.1:5432/qingxu_test?sslmode=disable',
    ]) {
      expect(() => storePhoneHashMaintenancePoolConfig({ DIRECT_URL: directUrl }, localConfig()))
        .toThrow('Local DIRECT_URL must be the approved mall_migrator connection');
    }
    expect(() => storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: 'postgresql://mall_migrator:migrator-test-password@127.0.0.1:5432/qingxu_test',
    }, localConfig({ allowInsecureLocalhost: false }))).toThrow(
      'Local DIRECT_URL must be the approved mall_migrator connection',
    );
  });

  it('rejects Supabase project scope and pooler-role mismatches before connecting', () => {
    expect(() => storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: 'postgresql://mall_migrator:migrator-test-password@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres?sslmode=verify-full',
      PGSSLROOTCERT: '/approved/ca.crt',
    }, remoteConfig())).toThrow('scoped to the approved mall_migrator project');
    expect(() => storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: 'postgresql://mall_migrator:migrator-test-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full',
      PGSSLROOTCERT: '/approved/ca.crt',
    }, remoteConfig())).toThrow('scoped to the approved mall_migrator project');
  });

  it.each([
    ['missing sslmode', ''],
    ['disabled sslmode', '?sslmode=disable'],
    ['unknown query parameter', '?sslmode=verify-full&application_name=unsafe'],
    ['repeated sslmode', '?sslmode=verify-full&sslmode=verify-full'],
  ])('rejects Supabase TLS parameters: %s', (_label, query) => {
    expect(() => storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: `postgresql://mall_migrator:migrator-test-password@db.${PROJECT_REF}.supabase.co:5432/postgres${query}`,
      PGSSLROOTCERT: '/approved/ca.crt',
    }, remoteConfig())).toThrow('must require full TLS verification');
  });

  it('rejects a DIRECT_URL certificate path that differs from PGSSLROOTCERT', () => {
    expect(() => storePhoneHashMaintenancePoolConfig({
      DIRECT_URL: `postgresql://mall_migrator:migrator-test-password@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=%2Fother%2Fca.crt`,
      PGSSLROOTCERT: '/approved/ca.crt',
    }, remoteConfig())).toThrow('must match PGSSLROOTCERT');
  });

  it('rejects REHASH_AND_VERIFY before Pool construction when no previous HMAC key is retained', async () => {
    vi.mocked(loadPlatformConfig).mockReturnValue({
      store: { phoneHashKeys: { current: { id: 'current', key: Buffer.alloc(32, 7) }, previous: [] } },
    } as unknown as PlatformRuntimeConfig);
    await expect(maintainStorePhoneHashes(
      invocation(STORE_PHONE_HASH_MAINTENANCE_MODES.REHASH_AND_VERIFY),
      ['node', 'maintenance.cli.ts'],
    )).rejects.toThrow('requires a retained previous HMAC key');
  });
});
