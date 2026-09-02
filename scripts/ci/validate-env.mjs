import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from "../db/lib/connection.mjs";

const required = [
  "DATABASE_URL",
  "DIRECT_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_PUBLIC_BASE_URL",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_FORCE_PATH_STYLE",
  "FIELD_ENCRYPTION_KEY_BASE64",
  "FIELD_ENCRYPTION_KEY_ID",
  "FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON",
  "AUDIT_IP_HASH_KEY_BASE64",
  "BANK_ACCOUNT_HASH_KEY_BASE64",
  "BANK_ACCOUNT_HASH_KEY_ID",
  "BANK_ACCOUNT_PREVIOUS_HASH_KEYS_JSON",
  "IDEMPOTENCY_HASH_KEY_BASE64",
  "IDEMPOTENCY_HASH_KEY_ID",
  "IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON",
  "AUTH_SIGNING_KEY_BASE64",
  "AUTH_SIGNING_KEY_ID",
  "AUTH_PREVIOUS_SIGNING_KEYS_JSON",
  "AUTH_SECRET_HASH_KEY_BASE64",
  "AUTH_SECRET_HASH_KEY_ID",
  "AUTH_PREVIOUS_SECRET_HASH_KEYS_JSON",
  "AUTH_TOKEN_ISSUER",
  "AUTH_TOKEN_AUDIENCE",
  "AUTH_ACCESS_TOKEN_TTL_SECONDS",
  "AUTH_PREAUTH_TOKEN_TTL_SECONDS",
  "AUTH_SESSION_TTL_SECONDS",
  "AGENT_AUTH_TOKEN_AUDIENCE",
  "AGENT_ACCESS_TOKEN_TTL_SECONDS",
  "AGENT_SESSION_TTL_SECONDS",
  "AGENT_LOGIN_RATE_LIMIT_MAX",
  "AGENT_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
  "STORE_PROMOTION_PUBLIC_BASE_URL",
  "STORE_AUTH_TOKEN_AUDIENCE",
  "STORE_IDENTITY_PROVIDER",
  "STORE_PHONE_PROVIDER",
  "STORE_PHONE_HASH_KEY_BASE64",
  "STORE_PHONE_HASH_KEY_ID",
  "STORE_PHONE_PREVIOUS_HASH_KEYS_JSON",
  "STORE_USER_AGREEMENT_VERSION",
  "STORE_USER_AGREEMENT_TITLE",
  "STORE_USER_AGREEMENT_URL",
  "STORE_PRIVACY_POLICY_VERSION",
  "STORE_PRIVACY_POLICY_TITLE",
  "STORE_PRIVACY_POLICY_URL",
  "STORE_PHONE_AUTHORIZATION_VERSION",
  "STORE_PHONE_AUTHORIZATION_TITLE",
  "STORE_PHONE_AUTHORIZATION_URL",
  "STORE_LEGAL_RATE_LIMIT_MAX",
  "STORE_LEGAL_RATE_LIMIT_WINDOW_SECONDS",
  "STORE_LOGIN_RATE_LIMIT_MAX",
  "STORE_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
  "STORE_CUSTOMER_RATE_LIMIT_MAX",
  "STORE_CUSTOMER_RATE_LIMIT_WINDOW_SECONDS",
  "STORE_PAYMENT_PROVIDER",
  "PAYMENT_PROVIDER_TIMEOUT_MS",
  "WORKER_POLL_INTERVAL_MS",
  "WORKER_BATCH_SIZE",
  "WORKER_MAX_RETRIES",
  "WORKER_BASE_RETRY_DELAY_MS",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`missing runtime environment values: ${missing.join(", ")}`);
  process.exit(1);
}

function parseUrl(name, protocols) {
  let url;
  try {
    url = new URL(process.env[name]);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} has an invalid protocol`);
  return url;
}

function decodeComponent(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
}

function decodeBase64Value(value, name) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`${name} must be canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error(`${name} must encode exactly 32 bytes`);
  }
  return decoded;
}

function decodeBase64Key(name) {
  return decodeBase64Value(process.env[name], name);
}

const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{3,80}$/;

function readPreviousKeys(name) {
  let entries;
  try {
    entries = JSON.parse(process.env[name]);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!Array.isArray(entries) || entries.length > 3) {
    throw new Error(`${name} must contain at most 3 keys`);
  }
  return entries.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object" ||
        Object.keys(entry).sort().join(",") !== "id,key_base64" ||
        typeof entry.id !== "string" || !KEY_ID_PATTERN.test(entry.id) ||
        typeof entry.key_base64 !== "string") {
      throw new Error(`${name}[${index}] has an invalid shape`);
    }
    return {
      id: entry.id,
      key: decodeBase64Value(entry.key_base64, `${name}[${index}].key_base64`),
    };
  });
}

function readKeyRing(idName, keyName, previousName) {
  if (!KEY_ID_PATTERN.test(process.env[idName])) throw new Error(`${idName} has an invalid format`);
  const entries = [
    { id: process.env[idName], key: decodeBase64Key(keyName) },
    ...readPreviousKeys(previousName),
  ];
  if (new Set(entries.map(({ id }) => id)).size !== entries.length ||
      entries.some((entry, index) => entries.some((candidate, candidateIndex) =>
        index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new Error(`${idName} key ring must contain unique IDs and keys`);
  }
  return entries;
}

function readBoundedInteger(name, minimum, maximum) {
  const raw = process.env[name];
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

try {
  const runtime = parseUrl("DATABASE_URL", ["postgres:", "postgresql:"]);
  const migrator = parseUrl("DIRECT_URL", ["postgres:", "postgresql:"]);
  const redis = parseUrl("REDIS_URL", ["redis:", "rediss:"]);
  const storage = parseUrl("S3_ENDPOINT", ["http:", "https:"]);
  const publicStorage = parseUrl("S3_PUBLIC_BASE_URL", ["http:", "https:"]);
  const promotionBase = parseUrl("STORE_PROMOTION_PUBLIC_BASE_URL", ["http:", "https:"]);
  const runtimeUsername = decodeComponent(runtime.username, "DATABASE_URL username");
  const migratorUsername = decodeComponent(migrator.username, "DIRECT_URL username");
  const runtimePassword = decodeComponent(runtime.password, "DATABASE_URL password");
  const migratorPassword = decodeComponent(migrator.password, "DIRECT_URL password");
  const redisPassword = decodeComponent(redis.password, "REDIS_URL password");

  if (runtimeUsername.split(".")[0] !== "mall_runtime") {
    throw new Error("DATABASE_URL must authenticate as mall_runtime");
  }
  if (migratorUsername.split(".")[0] !== "mall_migrator") {
    throw new Error("DIRECT_URL must authenticate as mall_migrator");
  }
  if (!runtimePassword || !migratorPassword || runtimePassword === migratorPassword) {
    throw new Error("database roles require independent non-empty passwords");
  }
  const ephemeralCi = process.env.CI === "true" && process.env.ALLOW_CI_EPHEMERAL_POSTGRES === "1";
  if (ephemeralCi) {
    const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    if (!localHosts.has(runtime.hostname) || runtime.hostname !== migrator.hostname) {
      throw new Error("CI database URLs must target the same disposable local PostgreSQL host");
    }
    if (runtime.port !== migrator.port || runtime.pathname !== migrator.pathname) {
      throw new Error("CI database URLs must target the same database and port");
    }
    if (runtime.search !== "" || migrator.search !== "") {
      throw new Error("CI database URLs must not contain query parameters");
    }
  } else {
    readConnection("DATABASE_URL", "runtime");
    readConnection("DIRECT_URL", "migrator");
  }
  for (const [name, url] of [["DATABASE_URL", runtime], ["DIRECT_URL", migrator]]) {
    if (/service_role|anon[_-]?key/i.test(url.toString())) {
      throw new Error(`${name} must not contain a Supabase API key`);
    }
  }
  if (!redis.hostname || redisPassword.length < 12) {
    throw new Error("REDIS_URL requires a host and a password of at least 12 characters");
  }
  if (redis.search !== "" || redis.hash !== "") {
    throw new Error("REDIS_URL must not contain query parameters or a fragment");
  }
  const localRedisHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if ((process.env.NODE_ENV === "production" || !localRedisHosts.has(redis.hostname)) && redis.protocol !== "rediss:") {
    throw new Error("remote and production REDIS_URL values must use rediss");
  }
  if (!storage.hostname || storage.username || storage.password || storage.pathname !== "/" ||
      storage.search !== "" || storage.hash !== "") {
    throw new Error("S3_ENDPOINT must be a credential-free origin");
  }
  if (!publicStorage.hostname || publicStorage.username || publicStorage.password ||
      publicStorage.search !== "" || publicStorage.hash !== "") {
    throw new Error("S3_PUBLIC_BASE_URL must be a credential-free URL");
  }
  if (publicStorage.pathname.replace(/\/$/, "") !== `/${process.env.S3_BUCKET}`) {
    throw new Error("S3_PUBLIC_BASE_URL path must identify S3_BUCKET");
  }
  const localStorageHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  for (const [name, url] of [["S3_ENDPOINT", storage], ["S3_PUBLIC_BASE_URL", publicStorage]]) {
    if ((process.env.NODE_ENV === "production" || !localStorageHosts.has(url.hostname)) &&
        url.protocol !== "https:") {
      throw new Error(`remote and production ${name} values must use https`);
    }
  }
  if (!promotionBase.hostname || promotionBase.username || promotionBase.password ||
      promotionBase.search !== "" || promotionBase.hash !== "" ||
      process.env.STORE_PROMOTION_PUBLIC_BASE_URL.length > 500) {
    throw new Error("STORE_PROMOTION_PUBLIC_BASE_URL must be a credential-free URL without query or fragment");
  }
  const localPromotionHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if ((process.env.NODE_ENV === "production" || !localPromotionHosts.has(promotionBase.hostname)) &&
      promotionBase.protocol !== "https:") {
    throw new Error("remote and production STORE_PROMOTION_PUBLIC_BASE_URL values must use https");
  }
  if (!/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(process.env.S3_BUCKET) ||
      process.env.S3_BUCKET.includes("..")) {
    throw new Error("S3_BUCKET must be a DNS-compatible bucket name");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(process.env.S3_REGION)) {
    throw new Error("S3_REGION has an invalid format");
  }
  const storageSecretContainsControl = Array.from(process.env.S3_SECRET_KEY).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(process.env.S3_ACCESS_KEY) ||
      process.env.S3_SECRET_KEY.length < 16 || process.env.S3_SECRET_KEY.length > 256 ||
      storageSecretContainsControl) {
    throw new Error("S3 bucket and credentials do not meet the development minimum");
  }
  if (process.env.S3_FORCE_PATH_STYLE !== "true" && process.env.S3_FORCE_PATH_STYLE !== "false") {
    throw new Error("S3_FORCE_PATH_STYLE must be true or false");
  }
  const bannerTargetOrigins = process.env.BANNER_TARGET_ORIGINS?.trim();
  if (bannerTargetOrigins) {
    if (bannerTargetOrigins.length > 2_048) throw new Error("BANNER_TARGET_ORIGINS is too long");
    const values = bannerTargetOrigins.split(",").map((value) => value.trim());
    if (values.length > 20 || values.some((value) => value.length === 0)) {
      throw new Error("BANNER_TARGET_ORIGINS must contain between 1 and 20 HTTPS origins");
    }
    const origins = values.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
          url.search || url.hash || value !== url.origin) {
        throw new Error("BANNER_TARGET_ORIGINS must contain canonical HTTPS origins without paths");
      }
      return url.origin;
    });
    if (new Set(origins).size !== origins.length) {
      throw new Error("BANNER_TARGET_ORIGINS must not contain duplicates");
    }
  }
  const fieldEncryptionKeys = readKeyRing(
    "FIELD_ENCRYPTION_KEY_ID",
    "FIELD_ENCRYPTION_KEY_BASE64",
    "FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON",
  );
  const auditIpHashKey = decodeBase64Key("AUDIT_IP_HASH_KEY_BASE64");
  const idempotencyKeys = readKeyRing(
    "IDEMPOTENCY_HASH_KEY_ID",
    "IDEMPOTENCY_HASH_KEY_BASE64",
    "IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON",
  );
  const authSigningKeys = readKeyRing(
    "AUTH_SIGNING_KEY_ID",
    "AUTH_SIGNING_KEY_BASE64",
    "AUTH_PREVIOUS_SIGNING_KEYS_JSON",
  );
  const authSecretHashKeys = readKeyRing(
    "AUTH_SECRET_HASH_KEY_ID",
    "AUTH_SECRET_HASH_KEY_BASE64",
    "AUTH_PREVIOUS_SECRET_HASH_KEYS_JSON",
  );
  const storePhoneHashKeys = readKeyRing(
    "STORE_PHONE_HASH_KEY_ID",
    "STORE_PHONE_HASH_KEY_BASE64",
    "STORE_PHONE_PREVIOUS_HASH_KEYS_JSON",
  );
  const bankAccountHashKeys = readKeyRing(
    "BANK_ACCOUNT_HASH_KEY_ID",
    "BANK_ACCOUNT_HASH_KEY_BASE64",
    "BANK_ACCOUNT_PREVIOUS_HASH_KEYS_JSON",
  );
  for (const [name, value] of [
    ["AUTH_TOKEN_ISSUER", process.env.AUTH_TOKEN_ISSUER],
    ["AUTH_TOKEN_AUDIENCE", process.env.AUTH_TOKEN_AUDIENCE],
    ["STORE_AUTH_TOKEN_AUDIENCE", process.env.STORE_AUTH_TOKEN_AUDIENCE],
    ["AGENT_AUTH_TOKEN_AUDIENCE", process.env.AGENT_AUTH_TOKEN_AUDIENCE],
  ]) {
    if (!/^[A-Za-z0-9._:/-]{3,120}$/.test(value)) throw new Error(`${name} has an invalid format`);
  }
  if (process.env.STORE_AUTH_TOKEN_AUDIENCE !== "qingxu-store" ||
      process.env.STORE_AUTH_TOKEN_AUDIENCE === process.env.AUTH_TOKEN_AUDIENCE) {
    throw new Error("STORE_AUTH_TOKEN_AUDIENCE must be qingxu-store and differ from AUTH_TOKEN_AUDIENCE");
  }
  if (process.env.AGENT_AUTH_TOKEN_AUDIENCE !== "qingxu-agent-web" ||
      process.env.AGENT_AUTH_TOKEN_AUDIENCE === process.env.AUTH_TOKEN_AUDIENCE ||
      process.env.AGENT_AUTH_TOKEN_AUDIENCE === process.env.STORE_AUTH_TOKEN_AUDIENCE) {
    throw new Error(
      "AGENT_AUTH_TOKEN_AUDIENCE must be qingxu-agent-web and differ from Admin/Store audiences",
    );
  }
  for (const name of ["STORE_IDENTITY_PROVIDER", "STORE_PHONE_PROVIDER"]) {
    const value = process.env[name];
    if (value !== "MOCK" && value !== "WECHAT") throw new Error(`${name} must be MOCK or WECHAT`);
    if (process.env.NODE_ENV === "production" && value === "MOCK") {
      throw new Error(`${name}=MOCK is forbidden in production`);
    }
  }
  const paymentProvider = process.env.STORE_PAYMENT_PROVIDER;
  if (paymentProvider !== "MOCK" && paymentProvider !== "WECHAT") {
    throw new Error("STORE_PAYMENT_PROVIDER must be MOCK or WECHAT");
  }
  if (process.env.NODE_ENV === "production" && paymentProvider === "MOCK") {
    throw new Error("STORE_PAYMENT_PROVIDER=MOCK is forbidden in production");
  }
  if (paymentProvider === "MOCK" && !process.env.PAYMENT_MOCK_SIGNING_KEY_BASE64) {
    throw new Error("PAYMENT_MOCK_SIGNING_KEY_BASE64 is required for the Mock payment provider");
  }
  const paymentMockSigningKey = process.env.PAYMENT_MOCK_SIGNING_KEY_BASE64
    ? decodeBase64Key("PAYMENT_MOCK_SIGNING_KEY_BASE64")
    : undefined;
  readBoundedInteger("PAYMENT_PROVIDER_TIMEOUT_MS", 100, 30_000);
  if (process.env.STORE_IDENTITY_PROVIDER === "WECHAT" || process.env.STORE_PHONE_PROVIDER === "WECHAT") {
    const appId = process.env.STORE_WECHAT_APP_ID?.trim() ?? "";
    const appSecret = process.env.STORE_WECHAT_APP_SECRET?.trim() ?? "";
    if (appId.length < 1 || appId.length > 128 || appSecret.length < 16 || appSecret.length > 256) {
      throw new Error("WECHAT Store providers require bounded STORE_WECHAT_APP_ID and STORE_WECHAT_APP_SECRET");
    }
  }
  for (const prefix of ["USER_AGREEMENT", "PRIVACY_POLICY", "PHONE_AUTHORIZATION"]) {
    const version = process.env[`STORE_${prefix}_VERSION`];
    const title = process.env[`STORE_${prefix}_TITLE`];
    if (version.length < 1 || version.length > 80 || title.length < 1 || title.length > 120) {
      throw new Error(`STORE_${prefix} version or title is outside the CH-016 bounds`);
    }
    const documentUrl = parseUrl(`STORE_${prefix}_URL`, ["https:"]);
    if (!documentUrl.hostname || documentUrl.username || documentUrl.password ||
        process.env[`STORE_${prefix}_URL`].length > 500) {
      throw new Error(`STORE_${prefix}_URL must be a credential-free HTTPS URL of at most 500 characters`);
    }
  }
  const fixedStoreLimits = [
    ["STORE_LEGAL_RATE_LIMIT_MAX", 120],
    ["STORE_LEGAL_RATE_LIMIT_WINDOW_SECONDS", 60],
    ["STORE_LOGIN_RATE_LIMIT_MAX", 10],
    ["STORE_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900],
    ["STORE_CUSTOMER_RATE_LIMIT_MAX", 120],
    ["STORE_CUSTOMER_RATE_LIMIT_WINDOW_SECONDS", 60],
  ];
  for (const [name, expected] of fixedStoreLimits) {
    if (readBoundedInteger(name, 1, 86_400) !== expected) {
      throw new Error(`${name} must equal the CH-018 fixed value ${expected}`);
    }
  }
  for (const [name, minimum, maximum] of [
    ["AUTH_ACCESS_TOKEN_TTL_SECONDS", 300, 3_600],
    ["AUTH_PREAUTH_TOKEN_TTL_SECONDS", 60, 300],
    ["AUTH_SESSION_TTL_SECONDS", 3_600, 2_592_000],
  ]) {
    readBoundedInteger(name, minimum, maximum);
  }
  const agentAccessTtl = readBoundedInteger("AGENT_ACCESS_TOKEN_TTL_SECONDS", 300, 3_600);
  const agentSessionTtl = readBoundedInteger("AGENT_SESSION_TTL_SECONDS", 3_600, 2_592_000);
  if (agentSessionTtl < agentAccessTtl) {
    throw new Error("AGENT_SESSION_TTL_SECONDS must be greater than or equal to AGENT_ACCESS_TOKEN_TTL_SECONDS");
  }
  readBoundedInteger("AGENT_LOGIN_RATE_LIMIT_MAX", 1, 1_000);
  readBoundedInteger("AGENT_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 1, 86_400);
  const purposeKeys = [
    ...fieldEncryptionKeys.map(({ key }) => key),
    auditIpHashKey,
    ...idempotencyKeys.map(({ key }) => key),
    ...authSigningKeys.map(({ key }) => key),
    ...authSecretHashKeys.map(({ key }) => key),
    ...storePhoneHashKeys.map(({ key }) => key),
    ...bankAccountHashKeys.map(({ key }) => key),
    ...(paymentMockSigningKey ? [paymentMockSigningKey] : []),
  ];
  if (purposeKeys.some((key, index) => purposeKeys.some((candidate, candidateIndex) =>
    index !== candidateIndex && key.equals(candidate)))) {
    throw new Error(
      "authentication, Store phone, bank account, payment Mock, field encryption, audit, and idempotency keys must be independent",
    );
  }
  readBoundedInteger("WORKER_POLL_INTERVAL_MS", 100, 60_000);
  readBoundedInteger("WORKER_BATCH_SIZE", 1, 100);
  readBoundedInteger("WORKER_MAX_RETRIES", 1, 20);
  readBoundedInteger("WORKER_BASE_RETRY_DELAY_MS", 100, 60_000);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log("runtime environment contract passed");
