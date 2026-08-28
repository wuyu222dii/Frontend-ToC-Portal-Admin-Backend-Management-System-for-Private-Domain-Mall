import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

function quoteSqlLiteral(value) {
  if (value.includes("\0")) throw new Error("CI database password cannot contain NUL bytes");
  return `'${value.replaceAll("'", "''")}'`;
}

function runPsql(connection, args, input, capture = false) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: postgresEnvironment(connection),
    encoding: "utf8",
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

function verifyB9MigrationFailurePath(replay, migrator) {
  const fixtureIds = {
    firstLedger: "01J00000000000000000000001",
    secondLedger: "01J00000000000000000000002",
    sku: "01J00000000000000000000003",
    business: "01J00000000000000000000004",
  };
  const indexNames = [
    "inventory_reservation_item_sku_id_reservation_id_idx",
    "uq_inventory_ledger_business_fact",
  ];

  runPsql(replay, [], `
    SET session_replication_role = replica;
    INSERT INTO public.inventory_ledger (
      id, sku_id, ledger_type, business_id, physical_change, locked_change,
      physical_after, locked_after, reason
    ) VALUES
      ('${fixtureIds.firstLedger}', '${fixtureIds.sku}', 'ORDER_RESERVE', '${fixtureIds.business}', 0, 0, 0, 0, 'B9 migration duplicate preflight fixture'),
      ('${fixtureIds.secondLedger}', '${fixtureIds.sku}', 'ORDER_RESERVE', '${fixtureIds.business}', 0, 0, 0, 0, 'B9 migration duplicate preflight fixture');
    SET session_replication_role = origin;
  `);

  let migrationUnexpectedlySucceeded = false;
  let expectedPreflightFailure = false;
  let residue;
  try {
    const failure = spawnSync(
      "psql",
      ["-X", "-v", "ON_ERROR_STOP=1", "-f", "prisma/migrations/0002_b9_inventory_fact_indexes/migration.sql"],
      {
        env: postgresEnvironment(migrator),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    if (failure.error) throw failure.error;
    migrationUnexpectedlySucceeded = failure.status === 0;
    expectedPreflightFailure = failure.stderr.includes(
      "inventory ledger contains duplicate non-null business facts",
    );
    residue = runPsql(replay, [
      "-Atqc",
      `SELECT count(*) FROM pg_class
       WHERE relkind = 'i' AND relname IN (${indexNames.map((name) => `'${name}'`).join(", ")})`,
    ], undefined, true);
  } finally {
    runPsql(replay, [], `
      DROP INDEX IF EXISTS public."${indexNames[0]}";
      DROP INDEX IF EXISTS public."${indexNames[1]}";
      SET session_replication_role = replica;
      DELETE FROM public.inventory_ledger
      WHERE id IN ('${fixtureIds.firstLedger}', '${fixtureIds.secondLedger}');
      SET session_replication_role = origin;
    `);
  }

  if (migrationUnexpectedlySucceeded) {
    throw new Error("B9 migration accepted duplicate inventory business facts");
  }
  if (!expectedPreflightFailure) {
    throw new Error("B9 migration failed for an unexpected reason during duplicate preflight testing");
  }
  if (residue !== "0") {
    throw new Error("B9 migration failure left an index outside its transaction");
  }
  console.log("B9 duplicate-fact preflight failed atomically as expected");
}

function verifyB9IndexPlans(connection) {
  const reservationPlan = runPsql(connection, [
    "-Atqc",
    `SET enable_seqscan = off;
     EXPLAIN (COSTS OFF)
     SELECT reservation_id
     FROM public.inventory_reservation_item
     WHERE sku_id = '01J00000000000000000000003'
     ORDER BY reservation_id`,
  ], undefined, true);
  if (!reservationPlan.includes("inventory_reservation_item_sku_id_reservation_id_idx")) {
    throw new Error("B9 SKU-first reservation query does not use the new index");
  }

  const ledgerPlan = runPsql(connection, [
    "-Atqc",
    `SET enable_seqscan = off;
     EXPLAIN (COSTS OFF)
     SELECT business_id, sku_id, ledger_type
     FROM public.inventory_ledger
     WHERE business_id IS NOT NULL
     ORDER BY business_id, sku_id, ledger_type`,
  ], undefined, true);
  if (!ledgerPlan.includes("uq_inventory_ledger_business_fact")) {
    throw new Error("B9 inventory business-fact query does not use the unique index");
  }
  console.log("B9 migration index plans verified");
}

try {
  const replayRaw = process.env.REPLAY_DATABASE_URL || process.env.DIRECT_URL;
  if (!replayRaw) throw new Error("REPLAY_DATABASE_URL (or CI DIRECT_URL) is required");
  process.env.REPLAY_DATABASE_URL = replayRaw;
  const replay = readConnection("REPLAY_DATABASE_URL", "ci-replay");
  const occupied = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
  ], undefined, true);
  if (occupied !== "0") {
    throw new Error("CI replay database must have an empty public schema");
  }

  // Supabase provides this login role outside application migrations. Create a
  // CI-only equivalent so permission verification exercises the same role graph.
  runPsql(replay, [], `
    DO $setup$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $setup$;
  `);
  runPsql(replay, ["--single-transaction", "-f", "prisma/migrations/0001_initial/migration.sql"]);
  runPsql(replay, [], "GRANT anon, authenticated, service_role TO authenticator WITH INHERIT FALSE, SET TRUE;");
  runPsql(replay, ["-f", "scripts/db/sql/verify-baseline.sql"]);
  const migratorPassword = replay.password;
  runPsql(replay, [], [
    "BEGIN;",
    `ALTER ROLE mall_migrator PASSWORD ${quoteSqlLiteral(migratorPassword)};`,
    `ALTER ROLE mall_runtime PASSWORD ${quoteSqlLiteral(`${replay.password}-runtime`)};`,
    "COMMIT;",
  ].join("\n"));
  const migratorUrl = new URL(process.env.REPLAY_DATABASE_URL);
  migratorUrl.username = "mall_migrator";
  migratorUrl.password = migratorPassword;
  const migratorConnection = { ...replay, username: "mall_migrator", password: migratorPassword };
  const prisma = prismaInvocation([
    "migrate",
    "resolve",
    "--applied",
    "0001_initial",
    "--config",
    "prisma.config.ts",
  ]);
  const result = spawnSync(prisma.command, prisma.args, {
    env: prismaEnvironment(migratorUrl.toString(), postgresEnvironment(migratorConnection)),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Prisma baseline registration failed");

  verifyB9MigrationFailurePath(replay, migratorConnection);

  const deploy = prismaInvocation([
    "migrate",
    "deploy",
    "--config",
    "prisma.config.ts",
  ]);
  const deployResult = spawnSync(deploy.command, deploy.args, {
    env: prismaEnvironment(migratorUrl.toString(), postgresEnvironment(migratorConnection)),
    stdio: "inherit",
  });
  if (deployResult.error) throw deployResult.error;
  if (deployResult.status !== 0) throw new Error("Prisma post-baseline migration deployment failed");

  runPsql(replay, ["-f", "scripts/db/sql/post-bootstrap.sql"]);
  runPsql(replay, ["-At", "-f", "scripts/db/sql/verify.sql"]);
  verifyB9IndexPlans(migratorConnection);
  const diff = prismaInvocation([
    "migrate",
    "diff",
    "--from-schema",
    "prisma/schema.prisma",
    "--to-config-datasource",
    "--exit-code",
    "--config",
    "prisma.config.ts",
  ]);
  const diffResult = spawnSync(diff.command, diff.args, {
    env: prismaEnvironment(migratorUrl.toString(), postgresEnvironment(migratorConnection)),
    stdio: "inherit",
  });
  if (diffResult.error) throw diffResult.error;
  if (diffResult.status === 2) throw new Error("Prisma datamodel drift detected after migration replay");
  if (diffResult.status !== 0) throw new Error("Prisma migration diff failed after replay");
  console.log("CI ephemeral PostgreSQL migration replay passed");
} catch (error) {
  console.error(`CI migration replay failed: ${error.message}`);
  process.exit(1);
}
