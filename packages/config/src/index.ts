export const PROJECT_TIME_ZONE = 'Asia/Shanghai' as const;

export const SERVICE_DEFAULT_PORTS = {
  api: 3000,
  worker: 3001,
} as const;

export const SERVICE_DATABASE_POOL_LIMITS = {
  api: 10,
  worker: 5,
} as const;

export type ServiceName = keyof typeof SERVICE_DEFAULT_PORTS;
export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface PlatformRuntimeConfig {
  environment: RuntimeEnvironment;
  service: ServiceName;
  port: number;
  database: {
    url: string;
    poolMax: number;
    connectionTimeoutMs: number;
    projectRef: string | undefined;
    sslRootCertPath: string | undefined;
    allowInsecureLocalhost: boolean;
  };
  encryption: {
    key: Buffer;
    keyId: string;
    ipHashKey: Buffer;
    idempotencyHashKeys: {
      current: IdempotencyHashKeyConfig;
      previous: readonly IdempotencyHashKeyConfig[];
    };
  };
  worker: {
    pollIntervalMs: number;
    batchSize: number;
    maxRetries: number;
    baseRetryDelayMs: number;
  };
}

export interface IdempotencyHashKeyConfig {
  id: string;
  key: Buffer;
}

export interface LoadPlatformConfigOptions {
  service: ServiceName;
  requireDatabase?: boolean;
  requireEncryption?: boolean;
}

function readEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error('NODE_ENV must be development, test, or production');
}

function readInteger(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function readBase64Key(
  source: NodeJS.ProcessEnv,
  name: string,
  required: boolean,
): Buffer {
  const raw = source[name];
  if (!raw) {
    if (!required) return Buffer.alloc(32);
    throw new Error(`${name} is required`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new Error(`${name} must be canonical base64`);
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== raw) {
    throw new Error(`${name} must encode exactly 32 bytes`);
  }
  return decoded;
}

interface RuntimeDatabaseConnection {
  url: string;
  projectRef: string | undefined;
  sslRootCertPath: string | undefined;
  allowInsecureLocalhost: boolean;
}

function readRuntimeDatabaseConnection(
  source: NodeJS.ProcessEnv,
  required: boolean,
  environment: RuntimeEnvironment,
): RuntimeDatabaseConnection {
  const raw = source.DATABASE_URL;
  if (!raw) {
    if (!required) {
      return {
        url: '',
        projectRef: undefined,
        sslRootCertPath: undefined,
        allowInsecureLocalhost: false,
      };
    }
    throw new Error('DATABASE_URL is required');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  if (!url.username || !url.password) {
    throw new Error('DATABASE_URL must contain a non-empty role and password');
  }

  let username: string;
  try {
    username = decodeURIComponent(url.username).split('.')[0] ?? '';
  } catch {
    throw new Error('DATABASE_URL username contains invalid percent encoding');
  }
  if (username !== 'mall_runtime') {
    throw new Error('DATABASE_URL must authenticate as mall_runtime');
  }
  if (/service_role|anon[_-]?key/i.test(raw)) {
    throw new Error('DATABASE_URL must not contain a Supabase API key');
  }

  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (localHosts.has(url.hostname)) {
    const isEphemeralTest = environment === 'test'
      && source.CI === 'true'
      && source.ALLOW_CI_EPHEMERAL_POSTGRES === '1';
    if (!isEphemeralTest) {
      throw new Error('local PostgreSQL is allowed only for the explicit ephemeral CI test database');
    }
    if (url.search !== '') {
      throw new Error('local DATABASE_URL must not contain query parameters');
    }
    return {
      url: raw,
      projectRef: undefined,
      sslRootCertPath: undefined,
      allowInsecureLocalhost: true,
    };
  }

  const projectRef = source.SUPABASE_PROJECT_REF;
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
    throw new Error('SUPABASE_PROJECT_REF must identify the approved development project');
  }
  const directMatch = url.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/);
  const isPooler = /\.pooler\.supabase\.com$/.test(url.hostname);
  if ((!directMatch || directMatch[1] !== projectRef) && !isPooler) {
    throw new Error('DATABASE_URL must target the approved Supabase project');
  }
  if (isPooler && !decodeURIComponent(url.username).endsWith(`.${projectRef}`)) {
    throw new Error('DATABASE_URL pooler role must be scoped to SUPABASE_PROJECT_REF');
  }
  if ((url.port || '5432') !== '5432' || url.pathname !== '/postgres') {
    throw new Error('DATABASE_URL must use the Supabase direct/session postgres endpoint');
  }
  for (const parameter of url.searchParams.keys()) {
    if (parameter !== 'sslmode' && parameter !== 'sslrootcert') {
      throw new Error('DATABASE_URL contains an unsupported query parameter');
    }
  }
  if (url.searchParams.getAll('sslmode').length !== 1) {
    throw new Error('DATABASE_URL must contain exactly one sslmode parameter');
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('DATABASE_URL must set sslmode=verify-full');
  }
  if (url.searchParams.getAll('sslrootcert').length > 1) {
    throw new Error('DATABASE_URL must not repeat sslrootcert');
  }
  const queryRootCert = url.searchParams.get('sslrootcert') ?? undefined;
  const environmentRootCert = source.PGSSLROOTCERT?.trim() || undefined;
  if (queryRootCert && environmentRootCert && queryRootCert !== environmentRootCert) {
    throw new Error('DATABASE_URL sslrootcert must match PGSSLROOTCERT');
  }
  const sslRootCertPath = queryRootCert ?? environmentRootCert;
  if (!sslRootCertPath) {
    throw new Error('DATABASE_URL requires an explicit trusted CA path');
  }
  return {
    url: raw,
    projectRef,
    sslRootCertPath,
    allowInsecureLocalhost: false,
  };
}

function readKeyId(source: NodeJS.ProcessEnv, required: boolean): string {
  const keyId = source.FIELD_ENCRYPTION_KEY_ID?.trim();
  if (!keyId) {
    if (!required) return 'disabled';
    throw new Error('FIELD_ENCRYPTION_KEY_ID is required');
  }
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(keyId)) {
    throw new Error('FIELD_ENCRYPTION_KEY_ID has an invalid format');
  }
  return keyId;
}

const HASH_KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{3,80}$/;

function readIdempotencyHashKeyRing(
  source: NodeJS.ProcessEnv,
  required: boolean,
): { current: IdempotencyHashKeyConfig; previous: readonly IdempotencyHashKeyConfig[] } {
  if (!required) {
    return { current: { id: 'disabled', key: Buffer.alloc(32) }, previous: [] };
  }
  const currentId = source.IDEMPOTENCY_HASH_KEY_ID?.trim();
  if (!currentId || !HASH_KEY_ID_PATTERN.test(currentId)) {
    throw new Error('IDEMPOTENCY_HASH_KEY_ID has an invalid format');
  }
  const current = {
    id: currentId,
    key: readBase64Key(source, 'IDEMPOTENCY_HASH_KEY_BASE64', true),
  };
  const rawPrevious = source.IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON?.trim();
  if (!rawPrevious) {
    throw new Error('IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON is required; use [] before the first rotation');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPrevious);
  } catch {
    throw new Error('IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 3) {
    throw new Error('IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON must contain at most 3 keys');
  }
  const previous = parsed.map((entry, index): IdempotencyHashKeyConfig => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'id,key_base64') {
      throw new Error(`IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON[${index}] has an invalid shape`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !HASH_KEY_ID_PATTERN.test(record.id) ||
      typeof record.key_base64 !== 'string') {
      throw new Error(`IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON[${index}].id has an invalid format`);
    }
    const keySource = { IDEMPOTENCY_PREVIOUS_HASH_KEY_BASE64: record.key_base64 } as NodeJS.ProcessEnv;
    return {
      id: record.id,
      key: readBase64Key(keySource, 'IDEMPOTENCY_PREVIOUS_HASH_KEY_BASE64', true),
    };
  });
  const all = [current, ...previous];
  if (new Set(all.map(({ id }) => id)).size !== all.length) {
    throw new Error('idempotency HMAC key IDs must be unique');
  }
  if (all.some((entry, index) => all.some((candidate, candidateIndex) =>
    index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new Error('idempotency HMAC keys must be unique');
  }
  return { current, previous };
}

export function loadPlatformConfig(
  source: NodeJS.ProcessEnv,
  options: LoadPlatformConfigOptions,
): PlatformRuntimeConfig {
  const environment = readEnvironment(source.NODE_ENV);
  const requireDatabase = options.requireDatabase ?? true;
  const requireEncryption = options.requireEncryption ?? true;
  const portName = options.service === 'api' ? 'API_PORT' : 'WORKER_PORT';
  const poolName = options.service === 'api' ? 'API_DATABASE_POOL_MAX' : 'WORKER_DATABASE_POOL_MAX';
  const encryptionKey = readBase64Key(source, 'FIELD_ENCRYPTION_KEY_BASE64', requireEncryption);
  const ipHashKey = readBase64Key(source, 'AUDIT_IP_HASH_KEY_BASE64', requireEncryption);
  const idempotencyHashKeys = readIdempotencyHashKeyRing(source, requireEncryption);
  const databaseConnection = readRuntimeDatabaseConnection(source, requireDatabase, environment);
  if (requireEncryption && (encryptionKey.equals(ipHashKey) ||
    [idempotencyHashKeys.current, ...idempotencyHashKeys.previous]
      .some(({ key }) => encryptionKey.equals(key) || ipHashKey.equals(key)))) {
    throw new Error('field encryption, audit IP hashing, and idempotency hashing require independent keys');
  }

  return {
    environment,
    service: options.service,
    port: readInteger(source, portName, SERVICE_DEFAULT_PORTS[options.service], 1, 65_535),
    database: {
      ...databaseConnection,
      poolMax: readInteger(
        source,
        poolName,
        SERVICE_DATABASE_POOL_LIMITS[options.service],
        1,
        50,
      ),
      connectionTimeoutMs: readInteger(
        source,
        'DATABASE_CONNECTION_TIMEOUT_MS',
        5_000,
        100,
        60_000,
      ),
    },
    encryption: {
      key: encryptionKey,
      keyId: readKeyId(source, requireEncryption),
      ipHashKey,
      idempotencyHashKeys,
    },
    worker: {
      pollIntervalMs: readInteger(source, 'WORKER_POLL_INTERVAL_MS', 1_000, 100, 60_000),
      batchSize: readInteger(source, 'WORKER_BATCH_SIZE', 20, 1, 100),
      maxRetries: readInteger(source, 'WORKER_MAX_RETRIES', 8, 1, 20),
      baseRetryDelayMs: readInteger(source, 'WORKER_BASE_RETRY_DELAY_MS', 1_000, 100, 60_000),
    },
  };
}
