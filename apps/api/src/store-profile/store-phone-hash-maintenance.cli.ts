import { readFileSync } from 'node:fs';

import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import { Pool, type PoolConfig } from 'pg';

import { StorePhoneHashMaintenance } from './store-phone-hash-maintenance';

export const STORE_PHONE_HASH_DRAIN_APPROVAL = 'DRAIN_OLD_STORE_PHONE_HASH_WRITERS_APPROVED';
export const STORE_PHONE_HASH_MAINTENANCE_MODES = {
  REHASH_AND_VERIFY: 'REHASH_AND_VERIFY',
  VERIFY_CURRENT: 'VERIFY_CURRENT',
} as const;
export type StorePhoneHashMaintenanceMode =
  typeof STORE_PHONE_HASH_MAINTENANCE_MODES[keyof typeof STORE_PHONE_HASH_MAINTENANCE_MODES];
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function assertStorePhoneHashMaintenanceInvocation(
  argv: readonly string[],
  source: NodeJS.ProcessEnv,
): StorePhoneHashMaintenanceMode {
  if (argv.length !== 2) throw new TypeError('Store phone HMAC maintenance does not accept arguments');
  if (source.STORE_PHONE_HASH_DRAIN_OLD_WRITERS_APPROVAL !== STORE_PHONE_HASH_DRAIN_APPROVAL) {
    throw new TypeError('Store phone HMAC maintenance requires drain-old-writers approval');
  }
  const mode = source.STORE_PHONE_HASH_MAINTENANCE_MODE;
  if (mode !== STORE_PHONE_HASH_MAINTENANCE_MODES.REHASH_AND_VERIFY &&
    mode !== STORE_PHONE_HASH_MAINTENANCE_MODES.VERIFY_CURRENT) {
    throw new TypeError('Store phone HMAC maintenance mode is invalid');
  }
  return mode;
}

function decodedUsername(url: URL): string {
  try {
    return decodeURIComponent(url.username);
  } catch {
    throw new TypeError('DIRECT_URL username contains invalid percent encoding');
  }
}

function trustedCa(path: string): string {
  let value: string;
  try {
    value = readFileSync(path, 'utf8');
  } catch {
    throw new TypeError('DIRECT_URL TLS root certificate could not be read');
  }
  if (!value.includes('-----BEGIN CERTIFICATE-----') || !value.includes('-----END CERTIFICATE-----')) {
    throw new TypeError('DIRECT_URL TLS root certificate is invalid');
  }
  return value;
}

export function storePhoneHashMaintenancePoolConfig(
  source: NodeJS.ProcessEnv,
  config: PlatformRuntimeConfig,
): PoolConfig {
  const raw = source.DIRECT_URL;
  if (!raw) throw new TypeError('DIRECT_URL is required');
  let direct: URL;
  try {
    direct = new URL(raw);
  } catch {
    throw new TypeError('DIRECT_URL must be a PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !direct.password || direct.hash !== '') {
    throw new TypeError('DIRECT_URL must be an authenticated PostgreSQL URL');
  }
  const username = decodedUsername(direct);
  const local = LOCAL_HOSTS.has(direct.hostname);
  if (local) {
    const runtime = new URL(config.database.url);
    if (!config.database.allowInsecureLocalhost || username !== 'mall_migrator' || direct.search !== '' ||
      runtime.hostname !== direct.hostname || (runtime.port || '5432') !== (direct.port || '5432') ||
      runtime.pathname !== direct.pathname) {
      throw new TypeError('Local DIRECT_URL must be the approved mall_migrator connection');
    }
    return {
      application_name: 'qingxu-store-phone-hash-maintenance',
      connectionString: direct.toString(),
      connectionTimeoutMillis: config.database.connectionTimeoutMs,
      max: 1,
    };
  }

  const projectRef = config.database.projectRef;
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
    throw new TypeError('Store phone HMAC maintenance requires an approved Supabase project');
  }
  const directHost = direct.hostname === `db.${projectRef}.supabase.co`;
  const poolerHost = direct.hostname.endsWith('.pooler.supabase.com');
  if ((!directHost && !poolerHost) ||
    (directHost && username !== 'mall_migrator') ||
    (poolerHost && username !== `mall_migrator.${projectRef}`) ||
    (direct.port || '5432') !== '5432' || direct.pathname !== '/postgres') {
    throw new TypeError('DIRECT_URL must be scoped to the approved mall_migrator project');
  }
  const allowedParameters = new Set(['sslmode', 'sslrootcert']);
  if ([...direct.searchParams.keys()].some((key) => !allowedParameters.has(key)) ||
    direct.searchParams.getAll('sslmode').length !== 1 ||
    direct.searchParams.get('sslmode') !== 'verify-full' ||
    direct.searchParams.getAll('sslrootcert').length > 1) {
    throw new TypeError('DIRECT_URL must require full TLS verification');
  }
  const rootCertPath = source.PGSSLROOTCERT?.trim();
  if (!rootCertPath || (direct.searchParams.get('sslrootcert') ?? rootCertPath) !== rootCertPath) {
    throw new TypeError('DIRECT_URL TLS root certificate must match PGSSLROOTCERT');
  }
  const ca = trustedCa(rootCertPath);
  direct.searchParams.delete('sslmode');
  direct.searchParams.delete('sslrootcert');
  return {
    application_name: 'qingxu-store-phone-hash-maintenance',
    connectionString: direct.toString(),
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    max: 1,
    ssl: { ca, rejectUnauthorized: true },
  };
}

export async function maintainStorePhoneHashes(
  source: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): Promise<{ mode: StorePhoneHashMaintenanceMode; rehashed: number; verified: number }> {
  const mode = assertStorePhoneHashMaintenanceInvocation(argv, source);
  const config = loadPlatformConfig(source, {
    requireDatabase: true,
    requireEncryption: true,
    requireStorage: false,
    service: 'api',
  });
  if (mode === STORE_PHONE_HASH_MAINTENANCE_MODES.REHASH_AND_VERIFY &&
    config.store.phoneHashKeys.previous.length < 1) {
    throw new TypeError('Store phone HMAC maintenance requires a retained previous HMAC key');
  }
  const pool = new Pool(storePhoneHashMaintenancePoolConfig(source, config));
  try {
    const maintenance = new StorePhoneHashMaintenance(config, pool);
    if (mode === STORE_PHONE_HASH_MAINTENANCE_MODES.REHASH_AND_VERIFY) {
      return { mode, ...await maintenance.rehashAndVerify() };
    }
    return { mode, rehashed: 0, ...await maintenance.verifyCurrentOnly() };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  maintainStorePhoneHashes()
    .then(({ mode, rehashed, verified }) => {
      process.stdout.write(
        `Store phone HMAC maintenance completed: mode=${mode} verified=${verified} rehashed=${rehashed}\n`,
      );
    })
    .catch(() => {
      process.stderr.write('Store phone HMAC maintenance failed\n');
      process.exitCode = 1;
    });
}
