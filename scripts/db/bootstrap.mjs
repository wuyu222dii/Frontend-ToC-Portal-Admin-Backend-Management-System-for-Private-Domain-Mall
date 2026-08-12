import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

const migrationPath = "prisma/migrations/0001_initial/migration.sql";
const frozenPath = "product-materials/docs/03-技术设计/migrations/0001_initial/migration.sql";
const expectedDigest = "f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function quoteSqlLiteral(value) {
  if (value.includes("\0")) throw new Error("database role passwords cannot contain NUL bytes");
  return `'${value.replaceAll("'", "''")}'`;
}

function assertRolePassword(label, value) {
  if (value.length < 24) throw new Error(`${label} must contain at least 24 characters`);
  if (/[\r\n]/.test(value)) throw new Error(`${label} cannot contain line breaks`);
}

function runPsql(connection, args, input, capture = false) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: postgresEnvironment(connection),
    encoding: capture ? "utf8" : undefined,
    input,
    stdio: capture ? [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] :
      input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error("psql command failed");
  }
  return capture ? result.stdout.trim() : undefined;
}

function waitForLogin(connection) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = spawnSync("psql", ["-X", "-Atqc", "SELECT 1"], {
      env: { ...postgresEnvironment(connection), PGCONNECT_TIMEOUT: "5" },
      stdio: "ignore",
    });
    if (!result.error && result.status === 0) return;
    if (attempt < 8) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
  }
  throw new Error("application database role did not become available through the session pooler");
}

function registerBaselineAsMigrator(connection) {
  const prisma = prismaInvocation([
    "migrate",
    "resolve",
    "--applied",
    "0001_initial",
    "--config",
    "prisma.config.ts",
  ]);
  const result = spawnSync(
    prisma.command,
    prisma.args,
    {
      env: prismaEnvironment(process.env.DIRECT_URL, postgresEnvironment(connection)),
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Prisma could not register the applied baseline as mall_migrator");
  }
}

try {
  if (process.env.SUPABASE_BOOTSTRAP_CONFIRM !== "BOOTSTRAP_EMPTY_DEV_DATABASE") {
    throw new Error("SUPABASE_BOOTSTRAP_CONFIRM must equal BOOTSTRAP_EMPTY_DEV_DATABASE");
  }
  if (process.env.SUPABASE_DATA_API_DISABLED_ACK !== "true") {
    throw new Error("Data API must be disabled and SUPABASE_DATA_API_DISABLED_ACK=true");
  }

  const migratorPassword = process.env.MALL_MIGRATOR_PASSWORD;
  const runtimePassword = process.env.MALL_RUNTIME_PASSWORD;
  if (!migratorPassword || !runtimePassword) {
    throw new Error("MALL_MIGRATOR_PASSWORD and MALL_RUNTIME_PASSWORD are required");
  }
  assertRolePassword("MALL_MIGRATOR_PASSWORD", migratorPassword);
  assertRolePassword("MALL_RUNTIME_PASSWORD", runtimePassword);
  if (migratorPassword === runtimePassword) {
    throw new Error("mall_migrator and mall_runtime must use independent passwords");
  }

  const owner = readConnection("SUPABASE_OWNER_URL", "owner");
  const migrator = readConnection("DIRECT_URL", "migrator");
  const runtime = readConnection("DATABASE_URL", "runtime");
  if (migrator.password !== process.env.MALL_MIGRATOR_PASSWORD) {
    throw new Error("DIRECT_URL password must equal MALL_MIGRATOR_PASSWORD during bootstrap");
  }
  if (runtime.password !== process.env.MALL_RUNTIME_PASSWORD) {
    throw new Error("DATABASE_URL password must equal MALL_RUNTIME_PASSWORD during bootstrap");
  }

  if (digest(migrationPath) !== expectedDigest || digest(frozenPath) !== expectedDigest) {
    throw new Error("baseline migration differs from the frozen CH-005 artifact");
  }

  const state = runPsql(owner, [
    "-Atqc",
    `WITH public_tables AS (
       SELECT count(*)::integer AS total
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     )
     SELECT CASE
       WHEN public_tables.total = 0 THEN 'EMPTY'
       WHEN to_regclass('public.account') IS NOT NULL
        AND to_regclass('public.sales_order') IS NOT NULL
        AND to_regclass('public._prisma_migrations') IS NULL
        AND public_tables.total = 76 THEN 'BASELINE_ONLY'
       WHEN to_regclass('public.account') IS NOT NULL
        AND to_regclass('public.sales_order') IS NOT NULL
        AND to_regclass('public._prisma_migrations') IS NOT NULL
        AND public_tables.total = 77 THEN 'REGISTERED'
       ELSE 'INCONSISTENT'
     END
     FROM public_tables`,
  ], undefined, true);

  if (state === "INCONSISTENT") {
    throw new Error("database contains a partial application bootstrap; inspect it before retrying");
  }
  if (state === "BASELINE_ONLY") {
    throw new Error("database contains a baseline without Prisma migration history; inspect it before retrying");
  }
  if (state === "REGISTERED") {
    waitForLogin(migrator);
    waitForLogin(runtime);
    const history = runPsql(owner, [
      "-Atqc",
      `SELECT concat_ws('|',
         pg_get_userbyid(c.relowner),
         count(*) FILTER (
           WHERE m.migration_name = '0001_initial'
             AND m.finished_at IS NOT NULL
             AND m.rolled_back_at IS NULL
         )
       )
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN public._prisma_migrations m
       WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
       GROUP BY c.relowner`,
    ], undefined, true);
    if (history !== "mall_migrator|1") {
      throw new Error("existing Prisma migration history is not the completed mall_migrator baseline");
    }
  }
  if (state !== "EMPTY") {
    runPsql(owner, ["-f", "scripts/db/sql/verify-baseline.sql"]);
  }
  if (state === "EMPTY") {
    runPsql(owner, [], `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mall_migrator') THEN
    CREATE ROLE mall_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT mall_migrator TO postgres WITH INHERIT FALSE, SET TRUE;
`);
    runPsql(owner, ["--single-transaction", "-f", migrationPath]);
    console.log("frozen baseline SQL applied by the Supabase project owner");
  }
  if (state === "EMPTY") {
    runPsql(owner, ["-f", "scripts/db/sql/verify-baseline.sql"]);
  }

  if (state !== "REGISTERED") {
    const roleSql = [
      "BEGIN;",
      `ALTER ROLE mall_migrator PASSWORD ${quoteSqlLiteral(migratorPassword)};`,
      `ALTER ROLE mall_runtime PASSWORD ${quoteSqlLiteral(runtimePassword)};`,
      "COMMIT;",
    ].join("\n");
    runPsql(owner, [], roleSql);
    waitForLogin(migrator);
    waitForLogin(runtime);
    console.log("application database role credentials installed from process environment");
  }

  if (state !== "REGISTERED") {
    registerBaselineAsMigrator(migrator);
    console.log("Prisma registered the real baseline checksum as mall_migrator");
  }

  runPsql(owner, ["-f", "scripts/db/sql/post-bootstrap.sql"]);
  console.log("database bootstrap and migration-history ownership verification completed");
} catch (error) {
  console.error(`database bootstrap stopped: ${error.message}`);
  process.exit(1);
}
