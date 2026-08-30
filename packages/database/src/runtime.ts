import { readFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

import { PrismaClient } from '../.generated/prisma/client';
import type { Prisma } from '../.generated/prisma/client';

export interface DatabaseRuntimeConfig {
  databaseUrl: string;
  poolMax: number;
  connectionTimeoutMs: number;
  applicationName: string;
  projectRef?: string | undefined;
  sslRootCertPath?: string | undefined;
  allowInsecureLocalhost?: boolean | undefined;
}

export interface PrismaTransactionOptions {
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  maxWait?: number;
  timeout?: number;
}

export interface DatabaseRuntime {
  /**
   * A separately budgeted single-connection pool for session-scoped locks
   * whose protected work may use the main Prisma pool.
   */
  readonly coordinationPool: Pool;
  readonly prisma: PrismaClient;
  readonly pool: Pool;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;
  withPgTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  withPrismaTransaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: PrismaTransactionOptions,
  ): Promise<T>;
}

export async function runPgTransactionOnClient<T>(
  client: PoolClient,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let phase: 'begin' | 'work' | 'commit' | 'done' = 'begin';
  let destroyConnection = false;
  try {
    await client.query('BEGIN');
    phase = 'work';
    const result = await work(client);
    phase = 'commit';
    await client.query('COMMIT');
    phase = 'done';
    return result;
  } catch (originalError) {
    if (phase === 'begin') {
      destroyConnection = true;
    } else {
      if (phase === 'commit') destroyConnection = true;
      try {
        await client.query('ROLLBACK');
      } catch {
        destroyConnection = true;
      }
    }
    throw originalError;
  } finally {
    client.release(destroyConnection);
  }
}

interface ValidatedDatabaseConnection {
  connectionString: string;
  ssl?: PoolConfig['ssl'];
}

const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const TLS_QUERY_PARAMETERS = ['sslmode', 'sslrootcert'] as const;
function readTrustedCa(path: string): string {
  let ca: string;
  try {
    ca = readFileSync(path, 'utf8');
  } catch {
    throw new TypeError('Database TLS root certificate could not be read');
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new TypeError('Database TLS root certificate must contain a PEM certificate');
  }
  return ca;
}

function validateRuntimeDatabaseConnection(config: DatabaseRuntimeConfig): ValidatedDatabaseConnection {
  const raw = config.databaseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TypeError('DATABASE_URL must use PostgreSQL');
  }
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new TypeError('DATABASE_URL username contains invalid percent encoding');
  }
  if (!url.password || username.split('.')[0] !== 'mall_runtime') {
    throw new TypeError('DATABASE_URL must authenticate as mall_runtime');
  }

  if (LOCAL_DATABASE_HOSTS.has(url.hostname)) {
    if (config.allowInsecureLocalhost !== true) {
      throw new TypeError('Local DATABASE_URL is restricted to the explicit ephemeral test runtime');
    }
    if (config.sslRootCertPath || config.projectRef) {
      throw new TypeError('Local DATABASE_URL must not use Supabase TLS configuration');
    }
    if (url.search !== '') {
      throw new TypeError('Local DATABASE_URL must not contain query parameters');
    }
    return { connectionString: url.toString() };
  }

  if (!config.projectRef || !/^[a-z]{20}$/.test(config.projectRef)) {
    throw new TypeError('Supabase runtime requires an approved project reference');
  }
  const directMatch = url.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/);
  const sessionPooler = url.hostname.endsWith('.pooler.supabase.com');
  if ((!directMatch || directMatch[1] !== config.projectRef) && !sessionPooler) {
    throw new TypeError('DATABASE_URL must target the approved Supabase project');
  }
  if (directMatch && username !== 'mall_runtime') {
    throw new TypeError('Supabase direct DATABASE_URL must authenticate as mall_runtime');
  }
  if (sessionPooler && username !== `mall_runtime.${config.projectRef}`) {
    throw new TypeError('Supabase pooler role must be scoped to the approved project');
  }
  if ((url.port || '5432') !== '5432' || url.pathname !== '/postgres') {
    throw new TypeError('DATABASE_URL must use the Supabase direct/session postgres endpoint');
  }
  for (const parameter of url.searchParams.keys()) {
    if (parameter !== 'sslmode' && parameter !== 'sslrootcert') {
      throw new TypeError('DATABASE_URL contains an unsupported query parameter');
    }
  }
  if (url.searchParams.getAll('sslmode').length !== 1) {
    throw new TypeError('DATABASE_URL must contain exactly one sslmode parameter');
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    throw new TypeError('DATABASE_URL must require full TLS verification');
  }
  if (url.searchParams.getAll('sslrootcert').length > 1) {
    throw new TypeError('DATABASE_URL must not repeat sslrootcert');
  }
  if (!config.sslRootCertPath) {
    throw new TypeError('Supabase runtime requires an explicit TLS root certificate');
  }
  const queryRootCert = url.searchParams.get('sslrootcert');
  if (queryRootCert && queryRootCert !== config.sslRootCertPath) {
    throw new TypeError('DATABASE_URL TLS root certificate path does not match runtime configuration');
  }
  const ca = readTrustedCa(config.sslRootCertPath);
  for (const parameter of TLS_QUERY_PARAMETERS) url.searchParams.delete(parameter);
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
  };
}

function validateConfig(config: DatabaseRuntimeConfig): ValidatedDatabaseConnection {
  const connection = validateRuntimeDatabaseConnection(config);
  if (!Number.isInteger(config.poolMax) || config.poolMax < 1 || config.poolMax > 50) {
    throw new TypeError('Database pool maximum must be between 1 and 50');
  }
  if (
    !Number.isInteger(config.connectionTimeoutMs) ||
    config.connectionTimeoutMs < 100 ||
    config.connectionTimeoutMs > 60_000
  ) {
    throw new TypeError('Database connection timeout must be between 100 and 60000 ms');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(config.applicationName)) {
    throw new TypeError('Database application name is invalid');
  }
  return connection;
}

export function createDatabaseRuntime(config: DatabaseRuntimeConfig): DatabaseRuntime {
  const connection = validateConfig(config);
  const poolConfig: PoolConfig = {
    application_name: config.applicationName,
    connectionString: connection.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: 10_000,
    max: config.poolMax,
  };
  if (connection.ssl !== undefined) poolConfig.ssl = connection.ssl;
  const pool = new Pool(poolConfig);
  const coordinationPool = new Pool({ ...poolConfig, max: 1 });
  // pg emits idle-client network failures through EventEmitter. Keep the API
  // alive; the next lock attempt still receives its own connection error.
  coordinationPool.on('error', () => undefined);
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: false,
    onPoolError: () => undefined,
  });
  const prisma = new PrismaClient({ adapter });
  let disconnected = false;

  return {
    coordinationPool,
    prisma,
    pool,
    async connect(): Promise<void> {
      if (disconnected) throw new Error('Database runtime has already been disconnected');
      await prisma.$connect();
      await this.ping();
    },
    async disconnect(): Promise<void> {
      if (disconnected) return;
      disconnected = true;
      await prisma.$disconnect();
      await Promise.all([pool.end(), coordinationPool.end()]);
    },
    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async withPgTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      return runPgTransactionOnClient(client, work);
    },
    async withPrismaTransaction<T>(
      work: (transaction: Prisma.TransactionClient) => Promise<T>,
      options?: PrismaTransactionOptions,
    ): Promise<T> {
      return prisma.$transaction(work, options);
    },
  };
}
