import { readConnection } from "../db/lib/connection.mjs";

const required = [
  "DATABASE_URL",
  "DIRECT_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
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
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log("runtime environment contract passed");
