import { existsSync } from "node:fs";

const SUPABASE_DIRECT_HOST = /^db\.([a-z]{20})\.supabase\.co$/;
const SUPABASE_POOLER_HOST = /\.pooler\.supabase\.com$/;

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
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const directMatch = url.hostname.match(SUPABASE_DIRECT_HOST);
  const isPooler = SUPABASE_POOLER_HOST.test(url.hostname);

  if (!database || (mode !== "ci-replay" && database !== "postgres")) {
    fail(`${envName} must connect to the postgres database`);
  }

  if (mode === "ci-replay") {
    if (process.env.CI !== "true" || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== "1") {
      fail("ci-replay is allowed only for an explicit CI ephemeral PostgreSQL job");
    }
    if (username !== "postgres" || isPooler || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      fail("ci-replay must use the local postgres superuser on the disposable CI database");
    }
  } else {
    if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
      fail("SUPABASE_PROJECT_REF must be the 20-letter development project ref");
    }
    if (!directMatch && !isPooler) {
      fail(`${envName} must target a Supabase direct connection or session pooler`);
    }
    if (directMatch && directMatch[1] !== projectRef) {
      fail(`${envName} targets a different Supabase project`);
    }
    if (isPooler && !username.endsWith(`.${projectRef}`)) {
      fail(`${envName} pooler role must be scoped to SUPABASE_PROJECT_REF`);
    }
    if (url.searchParams.get("sslmode") !== "verify-full") {
      fail(`${envName} must set sslmode=verify-full`);
    }
    if (port !== "5432") {
      fail(`${envName} must use direct/session port 5432; transaction pooler 6543 is not allowed`);
    }
  }

  const expectedRole = {
    owner: "postgres",
    migrator: "mall_migrator",
    runtime: "mall_runtime",
  }[mode];
  if (expectedRole) {
    const actualRole = isPooler ? username.split(".")[0] : username;
    if (actualRole !== expectedRole) {
      fail(`${envName} must authenticate as ${expectedRole}`);
    }
  }

  const sslRootCert = url.searchParams.get("sslrootcert") || process.env.PGSSLROOTCERT;
  if (sslRootCert && !existsSync(sslRootCert)) {
    fail(`${envName} references an sslrootcert file that does not exist`);
  }

  return {
    database,
    host: url.hostname,
    password,
    port,
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
