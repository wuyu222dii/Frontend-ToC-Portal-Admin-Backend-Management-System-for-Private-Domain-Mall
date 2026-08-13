import { readConnection } from "../db/lib/connection.mjs";

const required = [
  "DATABASE_URL",
  "DIRECT_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "FIELD_ENCRYPTION_KEY_BASE64",
  "FIELD_ENCRYPTION_KEY_ID",
  "AUDIT_IP_HASH_KEY_BASE64",
  "IDEMPOTENCY_HASH_KEY_BASE64",
  "IDEMPOTENCY_HASH_KEY_ID",
  "IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON",
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

function readPreviousIdempotencyKeys() {
  let entries;
  try {
    entries = JSON.parse(process.env.IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON);
  } catch {
    throw new Error("IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON must be valid JSON");
  }
  if (!Array.isArray(entries) || entries.length > 3) {
    throw new Error("IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON must contain at most 3 keys");
  }
  return entries.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object" ||
        Object.keys(entry).sort().join(",") !== "id,key_base64" ||
        typeof entry.id !== "string" || !/^[A-Za-z0-9._:-]{3,80}$/.test(entry.id) ||
        typeof entry.key_base64 !== "string") {
      throw new Error(`IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON[${index}] has an invalid shape`);
    }
    return {
      id: entry.id,
      key: decodeBase64Value(entry.key_base64, `IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON[${index}].key_base64`),
    };
  });
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
  const runtimeUsername = decodeComponent(runtime.username, "DATABASE_URL username");
  const migratorUsername = decodeComponent(migrator.username, "DIRECT_URL username");
  const runtimePassword = decodeComponent(runtime.password, "DATABASE_URL password");
  const migratorPassword = decodeComponent(migrator.password, "DIRECT_URL password");

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
  if (!redis.password || redis.password.length < 12) throw new Error("REDIS_URL requires a strong password");
  if (!storage.hostname) throw new Error("S3_ENDPOINT requires a host");
  if (process.env.S3_BUCKET.length < 3 || process.env.S3_ACCESS_KEY.length < 3 || process.env.S3_SECRET_KEY.length < 12) {
    throw new Error("S3 bucket and credentials do not meet the development minimum");
  }
  const fieldEncryptionKey = decodeBase64Key("FIELD_ENCRYPTION_KEY_BASE64");
  const auditIpHashKey = decodeBase64Key("AUDIT_IP_HASH_KEY_BASE64");
  const idempotencyHashKey = decodeBase64Key("IDEMPOTENCY_HASH_KEY_BASE64");
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(process.env.IDEMPOTENCY_HASH_KEY_ID)) {
    throw new Error("IDEMPOTENCY_HASH_KEY_ID has an invalid format");
  }
  const idempotencyKeys = [
    { id: process.env.IDEMPOTENCY_HASH_KEY_ID, key: idempotencyHashKey },
    ...readPreviousIdempotencyKeys(),
  ];
  if (new Set(idempotencyKeys.map(({ id }) => id)).size !== idempotencyKeys.length ||
      idempotencyKeys.some((entry, index) => idempotencyKeys.some((candidate, candidateIndex) =>
        index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new Error("idempotency HMAC key IDs and keys must be unique");
  }
  if (fieldEncryptionKey.equals(auditIpHashKey) ||
      idempotencyKeys.some(({ key }) => fieldEncryptionKey.equals(key) || auditIpHashKey.equals(key))) {
    throw new Error("field encryption, audit IP hashing, and idempotency hashing require independent keys");
  }
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(process.env.FIELD_ENCRYPTION_KEY_ID)) {
    throw new Error("FIELD_ENCRYPTION_KEY_ID has an invalid format");
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
