import { isIP } from 'node:net';

export const PROJECT_TIME_ZONE = 'Asia/Shanghai' as const;

export const SERVICE_DEFAULT_PORTS = {
  api: 3000,
  worker: 3001,
} as const;

export const SERVICE_DATABASE_POOL_LIMITS = {
  api: 10,
  worker: 5,
} as const;

export const FILE_STORAGE_LIMITS = {
  maxUploadBytes: 5 * 1024 * 1024,
  pendingCleanupAgeSeconds: 24 * 60 * 60,
  privateDownloadTtlSeconds: 5 * 60,
  uploadTtlSeconds: 15 * 60,
} as const;

export type ServiceName = keyof typeof SERVICE_DEFAULT_PORTS;
export type RuntimeEnvironment = 'development' | 'test' | 'production';
export type StoreProvider = 'MOCK' | 'WECHAT';

export interface StoreLegalDocumentConfig {
  version: string;
  title: string;
  url: string;
}

export interface PlatformRuntimeConfig {
  environment: RuntimeEnvironment;
  service: ServiceName;
  port: number;
  http?: {
    trustedProxyCidrs: readonly string[];
  };
  banner: {
    targetOrigins: readonly string[];
  };
  database: {
    url: string;
    poolMax: number;
    connectionTimeoutMs: number;
    projectRef: string | undefined;
    sslRootCertPath: string | undefined;
    allowInsecureLocalhost: boolean;
  };
  encryption: {
    fieldKeys: SecurityKeyRingConfig;
    ipHashKey: Buffer;
    idempotencyHashKeys: {
      current: IdempotencyHashKeyConfig;
      previous: readonly IdempotencyHashKeyConfig[];
    };
  };
  redis: {
    url: string;
  };
  storage: {
    accessKey: string;
    bucket: string;
    endpoint: string;
    forcePathStyle: boolean;
    maxUploadBytes: number;
    pendingCleanupAgeSeconds: number;
    privateDownloadTtlSeconds: number;
    publicBaseUrl: string;
    region: string;
    secretKey: string;
    uploadTtlSeconds: number;
  };
  authentication: {
    accessTokenTtlSeconds: number;
    audience: string;
    issuer: string;
    preAuthTokenTtlSeconds: number;
    secretHashKeys: SecurityKeyRingConfig;
    sessionTtlSeconds: number;
    signingKeys: SecurityKeyRingConfig;
  };
  store: {
    authTokenAudience: string;
    identityProvider: StoreProvider;
    phoneHashKeys: SecurityKeyRingConfig;
    phoneProvider: StoreProvider;
    wechatAppId: string;
    wechatAppSecret: string | undefined;
    legalDocuments: {
      userAgreement: StoreLegalDocumentConfig;
      privacyPolicy: StoreLegalDocumentConfig;
      phoneAuthorization: StoreLegalDocumentConfig;
    };
    legalRateLimitMax: number;
    legalRateLimitWindowSeconds: number;
    loginRateLimitMax: number;
    loginRateLimitWindowSeconds: number;
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

export interface SecurityKeyConfig {
  id: string;
  key: Buffer;
}

export interface SecurityKeyRingConfig {
  current: SecurityKeyConfig;
  previous: readonly SecurityKeyConfig[];
}

export interface LoadPlatformConfigOptions {
  service: ServiceName;
  requireDatabase?: boolean;
  requireEncryption?: boolean;
  requireStorage?: boolean;
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

function readRuntimeRedisUrl(
  source: NodeJS.ProcessEnv,
  required: boolean,
  environment: RuntimeEnvironment,
): string {
  const raw = source.REDIS_URL;
  if (!raw) {
    if (!required) return '';
    throw new Error('REDIS_URL is required');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('REDIS_URL must be a valid Redis URL');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis or rediss');
  }
  let password: string;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('REDIS_URL password contains invalid percent encoding');
  }
  if (!url.hostname || password.length < 12) {
    throw new Error('REDIS_URL requires a host and a password of at least 12 characters');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('REDIS_URL must not contain query parameters or a fragment');
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if ((environment === 'production' || !localHosts.has(url.hostname)) && url.protocol !== 'rediss:') {
    throw new Error('Remote and production REDIS_URL values must use rediss');
  }
  return raw;
}

function readStorageUrl(
  source: NodeJS.ProcessEnv,
  name: 'S3_ENDPOINT' | 'S3_PUBLIC_BASE_URL',
  required: boolean,
  environment: RuntimeEnvironment,
): string {
  const raw = source[name]?.trim();
  if (!raw) {
    if (!required) return '';
    throw new Error(`${name} is required`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or a fragment`);
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if ((environment === 'production' || !localHosts.has(url.hostname)) && url.protocol !== 'https:') {
    throw new Error(`Remote and production ${name} values must use HTTPS`);
  }
  if (name === 'S3_ENDPOINT' && url.pathname !== '/') {
    throw new Error('S3_ENDPOINT must be an origin without a path');
  }
  return raw.replace(/\/$/, '');
}

function readStorageConfig(
  source: NodeJS.ProcessEnv,
  required: boolean,
  environment: RuntimeEnvironment,
): PlatformRuntimeConfig['storage'] {
  if (!required) {
    return {
      accessKey: '',
      bucket: '',
      endpoint: '',
      forcePathStyle: true,
      ...FILE_STORAGE_LIMITS,
      publicBaseUrl: '',
      region: '',
      secretKey: '',
    };
  }
  const bucket = source.S3_BUCKET?.trim() ?? '';
  if (!/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes('..')) {
    throw new Error('S3_BUCKET must be a DNS-compatible bucket name');
  }
  const region = source.S3_REGION?.trim() ?? '';
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(region)) {
    throw new Error('S3_REGION has an invalid format');
  }
  const accessKey = source.S3_ACCESS_KEY?.trim() ?? '';
  const secretKey = source.S3_SECRET_KEY?.trim() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(accessKey)) {
    throw new Error('S3_ACCESS_KEY has an invalid format');
  }
  const secretContainsControl = Array.from(secretKey).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (secretKey.length < 16 || secretKey.length > 256 || secretContainsControl) {
    throw new Error('S3_SECRET_KEY must contain between 16 and 256 printable characters');
  }
  const forcePathStyle = source.S3_FORCE_PATH_STYLE;
  if (forcePathStyle !== 'true' && forcePathStyle !== 'false') {
    throw new Error('S3_FORCE_PATH_STYLE must be true or false');
  }
  const endpoint = readStorageUrl(source, 'S3_ENDPOINT', true, environment);
  const publicBaseUrl = readStorageUrl(source, 'S3_PUBLIC_BASE_URL', true, environment);
  let publicUrl: URL;
  try {
    publicUrl = new URL(publicBaseUrl);
  } catch {
    throw new Error('S3_PUBLIC_BASE_URL must be a valid HTTP URL');
  }
  if (publicUrl.pathname.replace(/\/$/, '') !== `/${bucket}`) {
    throw new Error('S3_PUBLIC_BASE_URL path must identify S3_BUCKET');
  }
  return {
    accessKey,
    bucket,
    endpoint,
    forcePathStyle: forcePathStyle === 'true',
    ...FILE_STORAGE_LIMITS,
    publicBaseUrl,
    region,
    secretKey,
  };
}

function readBannerTargetOrigins(source: NodeJS.ProcessEnv): readonly string[] {
  const raw = source.BANNER_TARGET_ORIGINS?.trim();
  if (!raw) return [];
  if (raw.length > 2_048) throw new Error('BANNER_TARGET_ORIGINS is too long');
  const values = raw.split(',').map((value) => value.trim());
  if (values.length > 20 || values.some((value) => value.length === 0)) {
    throw new Error('BANNER_TARGET_ORIGINS must contain between 1 and 20 HTTPS origins');
  }
  const origins = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('BANNER_TARGET_ORIGINS must contain valid HTTPS origins');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || value !== url.origin) {
      throw new Error('BANNER_TARGET_ORIGINS must contain canonical HTTPS origins without paths');
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error('BANNER_TARGET_ORIGINS must not contain duplicates');
  }
  return origins;
}

function hasHostBits(bytes: readonly number[], prefixLength: number): boolean {
  const completeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  if (remainingBits !== 0) {
    const hostMask = (1 << (8 - remainingBits)) - 1;
    if (((bytes[completeBytes] ?? 0) & hostMask) !== 0) return true;
  }
  const firstHostByte = completeBytes + (remainingBits === 0 ? 0 : 1);
  return bytes.slice(firstHostByte).some((byte) => byte !== 0);
}

function parseIpv4Bytes(address: string): readonly number[] {
  return address.split('.').map(Number);
}

function parseIpv6Bytes(address: string): readonly number[] {
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const halves = canonical.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [
    ...left.map((group) => Number.parseInt(group, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((group) => Number.parseInt(group, 16)),
  ];
  return groups.flatMap((group) => [group >>> 8, group & 0xff]);
}

function formatIpv6(bytes: readonly number[]): string {
  const groups = Array.from({ length: 8 }, (_, index) =>
    (((bytes[index * 2] ?? 0) << 8) | (bytes[index * 2 + 1] ?? 0)).toString(16));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== '0') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === '0') end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart === -1) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLength).join(':');
  return `${left ? `${left}:` : ':'}:${right ? `${right}` : ''}`;
}

function isIpv4Mapped(bytes: readonly number[]): boolean {
  return bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
}

function canonicalProxyCidr(value: string): string {
  const parts = value.split('/');
  if (parts.length > 2 || !parts[0]) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must contain numeric IP addresses or CIDRs');
  }
  const address = parts[0];
  if (!/^[0-9A-Fa-f:.]+$/.test(address)) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must not contain hostnames, zones, or brackets');
  }
  const family = isIP(address);
  if (family === 0) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must contain numeric IP addresses or CIDRs');
  }
  const maximumPrefix = family === 4 ? 32 : 128;
  const prefixRaw = parts[1];
  if (prefixRaw !== undefined && !/^\d+$/.test(prefixRaw)) {
    throw new Error('API_TRUSTED_PROXY_CIDRS prefixes must be integers');
  }
  const prefixLength = prefixRaw === undefined ? maximumPrefix : Number(prefixRaw);
  if (!Number.isSafeInteger(prefixLength) || prefixLength < 0 || prefixLength > maximumPrefix) {
    throw new Error(`API_TRUSTED_PROXY_CIDRS IPv${family} prefixes must be between 0 and ${maximumPrefix}`);
  }
  if (prefixLength === 0) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must not trust every source address');
  }
  const bytes = family === 4 ? parseIpv4Bytes(address) : parseIpv6Bytes(address);
  if (hasHostBits(bytes, prefixLength)) {
    throw new Error('API_TRUSTED_PROXY_CIDRS CIDRs must use a network address');
  }
  if (family === 4) return `${bytes.join('.')}/${prefixLength}`;
  if (isIpv4Mapped(bytes)) {
    const mappedPrefixLength = prefixLength - 96;
    if (mappedPrefixLength === 0) {
      throw new Error('API_TRUSTED_PROXY_CIDRS must not trust every source address');
    }
    return `${bytes.slice(12).join('.')}/${mappedPrefixLength}`;
  }
  return `${formatIpv6(bytes)}/${prefixLength}`;
}

function readTrustedProxyCidrs(source: NodeJS.ProcessEnv): readonly string[] {
  const raw = source.API_TRUSTED_PROXY_CIDRS;
  if (raw === undefined || raw === '') return [];
  if (raw.length > 2_048) throw new Error('API_TRUSTED_PROXY_CIDRS is too long');
  if (raw.trim() === '') return [];
  const rawValues = raw.split(',');
  if (rawValues.some((value) => value.length > 64)) {
    throw new Error('API_TRUSTED_PROXY_CIDRS entries must not exceed 64 characters');
  }
  const values = rawValues.map((value) => value.trim());
  if (values.length > 20 || values.some((value) => value.length === 0)) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must contain between 1 and 20 entries');
  }
  const cidrs = values.map(canonicalProxyCidr);
  if (new Set(cidrs).size !== cidrs.length) {
    throw new Error('API_TRUSTED_PROXY_CIDRS must not contain semantic duplicates');
  }
  return cidrs;
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

function readSecurityKeyRing(
  source: NodeJS.ProcessEnv,
  options: {
    currentIdName: string;
    currentKeyName: string;
    previousName: string;
    required: boolean;
  },
): SecurityKeyRingConfig {
  if (!options.required) {
    return { current: { id: 'disabled', key: Buffer.alloc(32) }, previous: [] };
  }
  const id = source[options.currentIdName]?.trim();
  if (!id || !HASH_KEY_ID_PATTERN.test(id)) {
    throw new Error(`${options.currentIdName} has an invalid format`);
  }
  const current = { id, key: readBase64Key(source, options.currentKeyName, true) };
  const rawPrevious = source[options.previousName]?.trim();
  if (rawPrevious === undefined || rawPrevious === '') {
    throw new Error(`${options.previousName} is required; use [] before the first rotation`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPrevious);
  } catch {
    throw new Error(`${options.previousName} must be valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length > 3) {
    throw new Error(`${options.previousName} must contain at most 3 keys`);
  }
  const previous = parsed.map((entry, index): SecurityKeyConfig => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'id,key_base64') {
      throw new Error(`${options.previousName}[${index}] has an invalid shape`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !HASH_KEY_ID_PATTERN.test(record.id) ||
      typeof record.key_base64 !== 'string') {
      throw new Error(`${options.previousName}[${index}] has an invalid value`);
    }
    return {
      id: record.id,
      key: readBase64Key({ [options.currentKeyName]: record.key_base64 }, options.currentKeyName, true),
    };
  });
  const keys = [current, ...previous];
  if (new Set(keys.map((entry) => entry.id)).size !== keys.length ||
    keys.some((entry, index) => keys.some((candidate, candidateIndex) =>
      index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new Error(`${options.currentIdName} key ring must contain unique IDs and keys`);
  }
  return { current, previous };
}

function readIdentifier(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  required: boolean,
): string {
  const value = source[name]?.trim() || (required ? '' : fallback);
  if (!/^[A-Za-z0-9._:/-]{3,120}$/.test(value)) throw new Error(`${name} has an invalid format`);
  return value;
}

function readStoreProvider(
  source: NodeJS.ProcessEnv,
  name: 'STORE_IDENTITY_PROVIDER' | 'STORE_PHONE_PROVIDER',
  required: boolean,
  environment: RuntimeEnvironment,
): StoreProvider {
  const value = source[name]?.trim() || (required ? '' : 'MOCK');
  if (value !== 'MOCK' && value !== 'WECHAT') throw new Error(`${name} must be MOCK or WECHAT`);
  if (required && environment === 'production' && value === 'MOCK') {
    throw new Error(`${name}=MOCK is forbidden in production`);
  }
  return value;
}

function readBoundedText(
  source: NodeJS.ProcessEnv,
  name: string,
  maximumLength: number,
  required: boolean,
  fallback: string,
): string {
  const value = source[name]?.trim() || (required ? '' : fallback);
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 1 || value.length > maximumLength || hasControlCharacter) {
    throw new Error(`${name} must contain between 1 and ${maximumLength} non-control characters`);
  }
  return value;
}

function readHttpsDocumentUrl(
  source: NodeJS.ProcessEnv,
  name: string,
  required: boolean,
  fallback: string,
): string {
  const value = source[name]?.trim() || (required ? '' : fallback);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || value.length > 500) {
    throw new Error(`${name} must be a credential-free HTTPS URL of at most 500 characters`);
  }
  return value;
}

function readStoreConfig(
  source: NodeJS.ProcessEnv,
  required: boolean,
  environment: RuntimeEnvironment,
  adminAudience: string,
  phoneHashKeys: SecurityKeyRingConfig,
): PlatformRuntimeConfig['store'] {
  const identityProvider = readStoreProvider(source, 'STORE_IDENTITY_PROVIDER', required, environment);
  const phoneProvider = readStoreProvider(source, 'STORE_PHONE_PROVIDER', required, environment);
  const authTokenAudience = readIdentifier(source, 'STORE_AUTH_TOKEN_AUDIENCE', 'qingxu-store', required);
  if (required && authTokenAudience !== 'qingxu-store') {
    throw new Error('STORE_AUTH_TOKEN_AUDIENCE must be qingxu-store');
  }
  if (authTokenAudience === adminAudience) {
    throw new Error('STORE_AUTH_TOKEN_AUDIENCE must differ from AUTH_TOKEN_AUDIENCE');
  }

  const needsWechatCredentials = identityProvider === 'WECHAT' || phoneProvider === 'WECHAT';
  const wechatAppId = readBoundedText(
    source,
    'STORE_WECHAT_APP_ID',
    128,
    needsWechatCredentials,
    'qingxu-mock-store-app',
  );
  const rawWechatSecret = source.STORE_WECHAT_APP_SECRET?.trim();
  if ((needsWechatCredentials || rawWechatSecret) &&
    (!rawWechatSecret || rawWechatSecret.length < 16 || rawWechatSecret.length > 256)) {
    throw new Error('STORE_WECHAT_APP_SECRET must contain between 16 and 256 characters');
  }
  if (rawWechatSecret && Array.from(rawWechatSecret).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  })) {
    throw new Error('STORE_WECHAT_APP_SECRET must not contain control characters');
  }

  const legalRateLimitMax = readInteger(source, 'STORE_LEGAL_RATE_LIMIT_MAX', 120, 1, 10_000);
  const legalRateLimitWindowSeconds = readInteger(source, 'STORE_LEGAL_RATE_LIMIT_WINDOW_SECONDS', 60, 1, 3_600);
  const loginRateLimitMax = readInteger(source, 'STORE_LOGIN_RATE_LIMIT_MAX', 10, 1, 1_000);
  const loginRateLimitWindowSeconds = readInteger(source, 'STORE_LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900, 1, 86_400);
  if (legalRateLimitMax !== 120 || legalRateLimitWindowSeconds !== 60 ||
    loginRateLimitMax !== 10 || loginRateLimitWindowSeconds !== 900) {
    throw new Error('Store legal and login rate limits must match the CH-016 fixed values');
  }

  const document = (prefix: 'USER_AGREEMENT' | 'PRIVACY_POLICY' | 'PHONE_AUTHORIZATION') => ({
    version: readBoundedText(source, `STORE_${prefix}_VERSION`, 80, required, 'disabled-v1'),
    title: readBoundedText(source, `STORE_${prefix}_TITLE`, 120, required, 'Disabled document'),
    url: readHttpsDocumentUrl(
      source,
      `STORE_${prefix}_URL`,
      required,
      `https://example.invalid/${prefix.toLowerCase()}`,
    ),
  });

  return {
    authTokenAudience,
    identityProvider,
    phoneHashKeys,
    phoneProvider,
    wechatAppId,
    wechatAppSecret: rawWechatSecret || undefined,
    legalDocuments: {
      userAgreement: document('USER_AGREEMENT'),
      privacyPolicy: document('PRIVACY_POLICY'),
      phoneAuthorization: document('PHONE_AUTHORIZATION'),
    },
    legalRateLimitMax,
    legalRateLimitWindowSeconds,
    loginRateLimitMax,
    loginRateLimitWindowSeconds,
  };
}

export function loadPlatformConfig(
  source: NodeJS.ProcessEnv,
  options: LoadPlatformConfigOptions,
): PlatformRuntimeConfig {
  const environment = readEnvironment(source.NODE_ENV);
  const requireDatabase = options.requireDatabase ?? true;
  const requireEncryption = options.requireEncryption ?? true;
  const requireStorage = options.requireStorage ?? requireDatabase;
  const portName = options.service === 'api' ? 'API_PORT' : 'WORKER_PORT';
  const poolName = options.service === 'api' ? 'API_DATABASE_POOL_MAX' : 'WORKER_DATABASE_POOL_MAX';
  const fieldKeys = readSecurityKeyRing(source, {
    currentIdName: 'FIELD_ENCRYPTION_KEY_ID',
    currentKeyName: 'FIELD_ENCRYPTION_KEY_BASE64',
    previousName: 'FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON',
    required: requireEncryption,
  });
  const ipHashKey = readBase64Key(source, 'AUDIT_IP_HASH_KEY_BASE64', requireEncryption);
  const idempotencyHashKeys = readIdempotencyHashKeyRing(source, requireEncryption);
  const requireAuthentication = requireEncryption && options.service === 'api';
  const signingKeys = readSecurityKeyRing(source, {
    currentIdName: 'AUTH_SIGNING_KEY_ID',
    currentKeyName: 'AUTH_SIGNING_KEY_BASE64',
    previousName: 'AUTH_PREVIOUS_SIGNING_KEYS_JSON',
    required: requireAuthentication,
  });
  const secretHashKeys = readSecurityKeyRing(source, {
    currentIdName: 'AUTH_SECRET_HASH_KEY_ID',
    currentKeyName: 'AUTH_SECRET_HASH_KEY_BASE64',
    previousName: 'AUTH_PREVIOUS_SECRET_HASH_KEYS_JSON',
    required: requireAuthentication,
  });
  const phoneHashKeys = readSecurityKeyRing(source, {
    currentIdName: 'STORE_PHONE_HASH_KEY_ID',
    currentKeyName: 'STORE_PHONE_HASH_KEY_BASE64',
    previousName: 'STORE_PHONE_PREVIOUS_HASH_KEYS_JSON',
    required: requireAuthentication,
  });
  const databaseConnection = readRuntimeDatabaseConnection(source, requireDatabase, environment);
  const redisUrl = readRuntimeRedisUrl(source, requireDatabase, environment);
  const storage = readStorageConfig(source, requireStorage, environment);
  const infrastructureKeys = [
    ...[fieldKeys.current, ...fieldKeys.previous].map(({ key }) => key),
    ipHashKey,
    ...[idempotencyHashKeys.current, ...idempotencyHashKeys.previous].map(({ key }) => key),
  ];
  if (requireEncryption && infrastructureKeys.some((key, index) =>
    infrastructureKeys.some((candidate, candidateIndex) => index !== candidateIndex && key.equals(candidate)))) {
    throw new Error('field encryption, audit IP hashing, and idempotency hashing require independent keys');
  }
  if (requireAuthentication) {
    const purposeKeys = [
      ...infrastructureKeys,
      ...[signingKeys.current, ...signingKeys.previous].map(({ key }) => key),
      ...[secretHashKeys.current, ...secretHashKeys.previous].map(({ key }) => key),
      ...[phoneHashKeys.current, ...phoneHashKeys.previous].map(({ key }) => key),
    ];
    if (purposeKeys.some((key, index) => purposeKeys.some((candidate, candidateIndex) =>
      index !== candidateIndex && key.equals(candidate)))) {
      throw new Error('all authentication, encryption, audit, and idempotency keys must be independent');
    }
  }

  const adminAudience = readIdentifier(
    source,
    'AUTH_TOKEN_AUDIENCE',
    'qingxu-admin-web',
    requireAuthentication,
  );
  const store = readStoreConfig(source, requireAuthentication, environment, adminAudience, phoneHashKeys);

  return {
    environment,
    service: options.service,
    port: readInteger(source, portName, SERVICE_DEFAULT_PORTS[options.service], 1, 65_535),
    http: { trustedProxyCidrs: readTrustedProxyCidrs(source) },
    banner: { targetOrigins: readBannerTargetOrigins(source) },
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
      fieldKeys,
      ipHashKey,
      idempotencyHashKeys,
    },
    redis: { url: redisUrl },
    storage,
    authentication: {
      accessTokenTtlSeconds: readInteger(source, 'AUTH_ACCESS_TOKEN_TTL_SECONDS', 900, 300, 3_600),
      audience: adminAudience,
      issuer: readIdentifier(source, 'AUTH_TOKEN_ISSUER', 'qingxu-api', requireAuthentication),
      preAuthTokenTtlSeconds: readInteger(source, 'AUTH_PREAUTH_TOKEN_TTL_SECONDS', 300, 60, 300),
      secretHashKeys,
      sessionTtlSeconds: readInteger(source, 'AUTH_SESSION_TTL_SECONDS', 604_800, 3_600, 2_592_000),
      signingKeys,
    },
    store,
    worker: {
      pollIntervalMs: readInteger(source, 'WORKER_POLL_INTERVAL_MS', 1_000, 100, 60_000),
      batchSize: readInteger(source, 'WORKER_BATCH_SIZE', 20, 1, 100),
      maxRetries: readInteger(source, 'WORKER_MAX_RETRIES', 8, 1, 20),
      baseRetryDelayMs: readInteger(source, 'WORKER_BASE_RETRY_DELAY_MS', 1_000, 100, 60_000),
    },
  };
}
