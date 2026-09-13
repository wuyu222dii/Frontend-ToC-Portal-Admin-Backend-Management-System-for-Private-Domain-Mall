import { existsSync } from "node:fs";

const TENCENT_POSTGRES_HOST = /(?:^|\.)(?:sql|postgres|pg)\.tencentcdb\.com$/i;
const POSTGRES_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function fail(message) {
  throw new Error(message);
}

function decoded(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${label} is not valid percent-encoded text`);
  }
}

function assertNoSupabaseEnvironment() {
  const leftover = Object.keys(process.env).filter((name) => name.startsWith("SUPABASE_"));
  if (leftover.length > 0) {
    fail("SUPABASE_* environment variables are no longer accepted; use TencentDB PostgreSQL");
  }
}

function declaredProvider() {
  const raw = process.env.DATABASE_PROVIDER?.trim();
  if (!raw) return undefined;
  if (raw === "tencentdb") return raw;
  fail("DATABASE_PROVIDER must be tencentdb");
}

function readVerifiedTls(url, envName) {
  for (const parameter of url.searchParams.keys()) {
    if (parameter !== "sslmode" && parameter !== "sslrootcert") {
      fail(`${envName} contains an unsupported query parameter`);
    }
  }
  if (url.searchParams.getAll("sslmode").length !== 1) {
    fail(`${envName} must contain exactly one sslmode parameter`);
  }
  if (url.searchParams.get("sslmode") !== "verify-full") {
    fail(`${envName} must set sslmode=verify-full`);
  }
  if (url.searchParams.getAll("sslrootcert").length > 1) {
    fail(`${envName} must not repeat sslrootcert`);
  }

  const queryRootCert = url.searchParams.get("sslrootcert") || undefined;
  const environmentRootCert = process.env.PGSSLROOTCERT?.trim() || undefined;
  if (queryRootCert && environmentRootCert && queryRootCert !== environmentRootCert) {
    fail(`${envName} sslrootcert must match PGSSLROOTCERT`);
  }
  return queryRootCert || environmentRootCert;
}

export function readConnection(envName, mode) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) {
    fail("connection variable name is invalid");
  }

  const raw = process.env[envName];
  if (!raw) {
    fail(`${envName} is required`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${envName} must be a PostgreSQL URL`);
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail(`${envName} must use postgresql://`);
  }
  if (!url.username || !url.password) {
    fail(`${envName} must contain a non-empty role and password`);
  }

  const username = decoded(url.username, `${envName} username`);
  const password = decoded(url.password, `${envName} password`);
  const database = decoded(url.pathname.replace(/^\//, ""), `${envName} database`);
  const port = url.port || "5432";

  if (!database) {
    fail(`${envName} must connect to a PostgreSQL database`);
  }

  let provider;
  if (mode === "ci-replay") {
    if (process.env.CI !== "true" || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== "1") {
      fail("ci-replay is allowed only for an explicit CI ephemeral PostgreSQL job");
    }
    if (username !== "postgres" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      fail("ci-replay must use the local postgres superuser on the disposable CI database");
    }
    if (url.search !== "") {
      fail(`${envName} must not contain query parameters for a disposable CI database`);
    }
  } else {
    assertNoSupabaseEnvironment();
    if (/\.supabase\.(co|com)$/i.test(url.hostname)) {
      fail(`${envName} must not use Supabase; use TencentDB PostgreSQL`);
    }
    const localHosts = ["127.0.0.1", "localhost", "::1"];
    const isLocalDev = process.env.NODE_ENV === "development" && localHosts.includes(url.hostname);
    if (isLocalDev) {
      if (mode === "owner") {
        fail(`${envName} is only for TencentDB empty-database bootstrap`);
      }
      if (url.search !== "") {
        fail(`${envName} must not contain query parameters for local development`);
      }
    } else {
      const declared = declaredProvider();
      if (declared && declared !== "tencentdb") {
        fail("DATABASE_PROVIDER must be tencentdb");
      }
      if (!TENCENT_POSTGRES_HOST.test(url.hostname)) {
        fail(`${envName} must target an approved TencentDB PostgreSQL host`);
      }
      provider = "tencentdb";
      if (!POSTGRES_IDENT.test(database)) {
        fail(`${envName} must use a PostgreSQL database name`);
      }
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
        fail(`${envName} must use a valid PostgreSQL port`);
      }
    }
  }

  const expectedRole = {
    owner: "postgres",
    migrator: "mall_migrator",
    runtime: "mall_runtime",
  }[mode];
  if (expectedRole) {
    if (provider === "tencentdb" && mode === "owner") {
      if (!POSTGRES_IDENT.test(username) || username === "mall_runtime") {
        fail(`${envName} must authenticate as the TencentDB owner role`);
      }
    } else if (username !== expectedRole) {
      fail(`${envName} must authenticate as ${expectedRole}`);
    }
  }

  const sslRootCert = mode === "ci-replay" || provider === undefined
    ? undefined
    : readVerifiedTls(url, envName);
  if (sslRootCert && !existsSync(sslRootCert)) {
    fail(`${envName} references an sslrootcert file that does not exist`);
  }

  return {
    database,
    host: url.hostname,
    password,
    port,
    provider,
    sslmode: url.searchParams.get("sslmode") || undefined,
    sslrootcert: sslRootCert || undefined,
    username,
  };
}

export function postgresEnvironment(connection) {
  const env = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "PATH", "SYSTEMROOT", "TMPDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }

  Object.assign(env, {
    PGCONNECT_TIMEOUT: "15",
    PGDATABASE: connection.database,
    PGHOST: connection.host,
    PGPASSWORD: connection.password,
    PGPORT: connection.port,
    PGUSER: connection.username,
  });
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  if (connection.sslrootcert) env.PGSSLROOTCERT = connection.sslrootcert;
  return env;
}
