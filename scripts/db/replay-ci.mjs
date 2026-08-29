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

function verifyB10MigrationFailurePaths(replay, migrator) {
  const indexNames = [
    "uq_payment_attempt_one_success_per_intent",
    "uq_refund_one_late_payment_per_order",
  ];
  const scenarios = [
    {
      name: "duplicate successful payment attempts",
      expectedError: "payment attempt contains duplicate successful facts per intent",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.payment_attempt (
          id, payment_intent_id, provider, status, amount
        ) VALUES
          ('01J00000000000000000000005', '01J00000000000000000000007', 'MOCK', 'SUCCEEDED', 1.00),
          ('01J00000000000000000000006', '01J00000000000000000000007', 'MOCK', 'SUCCEEDED_LATE', 1.00);
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.payment_attempt
        WHERE id IN ('01J00000000000000000000005', '01J00000000000000000000006');
        SET session_replication_role = origin;
      `,
    },
    {
      name: "duplicate late-payment refunds",
      expectedError: "refund contains duplicate late-payment facts per order",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.refund (
          id, refund_no, order_id, origin_type, provider, amount, reason,
          is_late_payment_refund, updated_at
        ) VALUES
          ('01J00000000000000000000008', 'RF-B10-MIGRATION-0001', '01J0000000000000000000000A', 'LATE_PAYMENT', 'MOCK', 1.00, 'B10 duplicate preflight fixture', TRUE, CURRENT_TIMESTAMP),
          ('01J00000000000000000000009', 'RF-B10-MIGRATION-0002', '01J0000000000000000000000A', 'LATE_PAYMENT', 'MOCK', 1.00, 'B10 duplicate preflight fixture', TRUE, CURRENT_TIMESTAMP);
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.refund
        WHERE id IN ('01J00000000000000000000008', '01J00000000000000000000009');
        SET session_replication_role = origin;
      `,
    },
  ];

  for (const scenario of scenarios) {
    runPsql(replay, [], scenario.setup);
    let migrationUnexpectedlySucceeded = false;
    let expectedPreflightFailure = false;
    let residue;
    try {
      const failure = spawnSync(
        "psql",
        [
          "-X",
          "-v", "ON_ERROR_STOP=1",
          "--set=VERBOSITY=verbose",
          "-f", "prisma/migrations/0003_b10_payment_fact_indexes/migration.sql",
        ],
        {
          env: postgresEnvironment(migrator),
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      if (failure.error) throw failure.error;
      migrationUnexpectedlySucceeded = failure.status === 0;
      expectedPreflightFailure = failure.stderr.includes(scenario.expectedError) &&
        /ERROR:\s+23505:/.test(failure.stderr);
      residue = runPsql(replay, [
        "-Atqc",
        `SELECT count(*) FROM pg_class
         WHERE relkind = 'i' AND relname IN (${indexNames.map((name) => `'${name}'`).join(", ")})`,
      ], undefined, true);
    } finally {
      runPsql(replay, [], `
        DROP INDEX IF EXISTS public."${indexNames[0]}";
        DROP INDEX IF EXISTS public."${indexNames[1]}";
        ${scenario.cleanup}
      `);
    }

    if (migrationUnexpectedlySucceeded) {
      throw new Error(`B10 migration accepted ${scenario.name}`);
    }
    if (!expectedPreflightFailure) {
      throw new Error(`B10 migration failed for an unexpected reason while testing ${scenario.name}`);
    }
    if (residue !== "0") {
      throw new Error(`B10 migration failure left an index while testing ${scenario.name}`);
    }
  }
  console.log("B10 duplicate-fact preflights failed atomically as expected");
}

function verifyB10IndexPlans(connection) {
  const paymentPlan = runPsql(connection, [
    "-Atqc",
    `SET enable_seqscan = off;
     EXPLAIN (COSTS OFF)
     SELECT id
     FROM public.payment_attempt
     WHERE payment_intent_id = '01J00000000000000000000007'
       AND status IN ('SUCCEEDED', 'SUCCEEDED_LATE')`,
  ], undefined, true);
  if (!paymentPlan.includes("uq_payment_attempt_one_success_per_intent")) {
    throw new Error("B10 successful payment-attempt lookup does not use the unique index");
  }

  const refundPlan = runPsql(connection, [
    "-Atqc",
    `SET enable_seqscan = off;
     EXPLAIN (COSTS OFF)
     SELECT id
     FROM public.refund
     WHERE order_id = '01J0000000000000000000000A'
       AND origin_type = 'LATE_PAYMENT'`,
  ], undefined, true);
  if (!refundPlan.includes("uq_refund_one_late_payment_per_order")) {
    throw new Error("B10 late-payment refund lookup does not use the unique index");
  }
  console.log("B10 migration index plans verified");
}

function verifyB10CommissionPositionRuntime(replay) {
  const snapshotId = "01J0000000000000000000000B";
  const positionId = "01J0000000000000000000000C";
  const runtimePassword = `${replay.password}-runtime`;
  const runtime = { ...replay, username: "mall_runtime", password: runtimePassword };

  runPsql(replay, [], `
    SET session_replication_role = replica;
    INSERT INTO public.order_item_commission_snapshot (
      id, order_item_id, agent_id, rule_version_id, source_type,
      category_id_snapshot, category_name_snapshot, product_id_snapshot,
      sku_id_snapshot, effective_rate, commission_base, original_commission
    ) VALUES (
      '${snapshotId}', '01J0000000000000000000000D', '01J0000000000000000000000E',
      '01J0000000000000000000000F', 'PLATFORM', '01J0000000000000000000000G',
      'CH-023 runtime fixture', '01J0000000000000000000000H',
      '01J0000000000000000000000J', 10.0000, 10.00, 1.00
    );
    SET session_replication_role = origin;
  `);

  try {
    runPsql(runtime, [], `
      BEGIN;
      INSERT INTO public.order_item_commission_position (
        id, snapshot_id, state, original_commission, expected_remaining,
        reversed_total, available_at, version, updated_at
      ) VALUES (
        '${positionId}', '${snapshotId}', 'EXPECTED', 1.00, 1.00,
        0.00, NULL, 1, CURRENT_TIMESTAMP
      );
      DO $runtime$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.order_item_commission_position
          WHERE id = '${positionId}' AND snapshot_id = '${snapshotId}'
            AND original_commission = 1.00
        ) THEN
          RAISE EXCEPTION 'CH-023 runtime trigger fixture was not visible';
        END IF;
      END
      $runtime$;
      ROLLBACK;
    `);
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.order_item_commission_position WHERE id = '${positionId}';
      DELETE FROM public.order_item_commission_snapshot WHERE id = '${snapshotId}';
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT id FROM public.order_item_commission_snapshot WHERE id = '${snapshotId}'
       UNION ALL
       SELECT id FROM public.order_item_commission_position WHERE id = '${positionId}'
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("CH-023 runtime trigger test left fixture residue");
  console.log("CH-023 mall_runtime commission-position trigger path verified");
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
  verifyB10MigrationFailurePaths(replay, migratorConnection);

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
  verifyB10IndexPlans(migratorConnection);
  verifyB10CommissionPositionRuntime(replay);
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
