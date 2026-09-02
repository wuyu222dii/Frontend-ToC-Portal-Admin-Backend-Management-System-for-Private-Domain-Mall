import { spawn, spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { B13_PREDEPLOY_CHECKS } from "./lib/b13-preflight.mjs";
import {
  B13_DEPLOYED_HISTORY,
  B13_MIGRATION_HISTORY_SQL,
  isApprovedB13Predecessor,
  isExactB13History,
  requiresB13HistoricalPreflight,
} from "./lib/migration-history.mjs";
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

function expectPsqlFailure(connection, input, expectedError, label) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1"], {
    env: postgresEnvironment(connection),
    encoding: "utf8",
    input,
    stdio: ["pipe", "ignore", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) throw new Error(`${label} unexpectedly succeeded`);
  if (!result.stderr.includes(expectedError)) {
    throw new Error(`${label} failed for an unexpected reason`);
  }
}

function runPsqlAsync(connection, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1"], {
      env: postgresEnvironment(connection),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, stdout }));
    child.stdin.end(input);
  });
}

function resolveAppliedMigration(connection, migratorUrl, migrationName) {
  const prisma = prismaInvocation([
    "migrate",
    "resolve",
    "--applied",
    migrationName,
    "--config",
    "prisma.config.ts",
  ]);
  const result = spawnSync(prisma.command, prisma.args, {
    env: prismaEnvironment(migratorUrl, postgresEnvironment(connection)),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma could not register ${migrationName}`);
}

function waitForSleepingApplication(connection, applicationName) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const active = runPsql(connection, [
      "-Atqc",
      `SELECT count(*) FROM pg_stat_activity
       WHERE application_name = '${applicationName}'
         AND state = 'active'
         AND wait_event = 'PgSleep'`,
    ], undefined, true);
    if (active === "1") return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error(`${applicationName} did not reach its synchronization point`);
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

function verifyB12MigrationFailurePaths(replay, migrator) {
  const indexNames = [
    "uq_refund_attempt_one_active_per_refund",
    "uq_refund_attempt_one_success_per_refund",
  ];
  const scenarios = [
    {
      name: "duplicate active refund attempts",
      expectedError: "refund attempt contains duplicate active facts per refund",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.refund_attempt (
          id, refund_id, attempt_no, idempotency_key, provider, status
        ) VALUES
          ('01J0000000000000000000000K', '01J0000000000000000000000M', 1, 'b12-active-1', 'MOCK', 'INITIATED'),
          ('01J0000000000000000000000N', '01J0000000000000000000000M', 2, 'b12-active-2', 'MOCK', 'PROCESSING');
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.refund_attempt
        WHERE id IN ('01J0000000000000000000000K', '01J0000000000000000000000N');
        SET session_replication_role = origin;
      `,
    },
    {
      name: "duplicate successful refund attempts",
      expectedError: "refund attempt contains duplicate successful facts per refund",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.refund_attempt (
          id, refund_id, attempt_no, idempotency_key, provider,
          provider_request_id, status
        ) VALUES
          ('01J0000000000000000000000P', '01J0000000000000000000000Q', 1, 'b12-success-1', 'MOCK', 'b12-success-request-1', 'SUCCEEDED'),
          ('01J0000000000000000000000R', '01J0000000000000000000000Q', 2, 'b12-success-2', 'MOCK', 'b12-success-request-2', 'SUCCEEDED');
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.refund_attempt
        WHERE id IN ('01J0000000000000000000000P', '01J0000000000000000000000R');
        SET session_replication_role = origin;
      `,
    },
  ];

  for (const scenario of scenarios) {
    runPsql(replay, [], scenario.setup);
    try {
      const failure = spawnSync(
        "psql",
        [
          "-X",
          "-v", "ON_ERROR_STOP=1",
          "--set=VERBOSITY=verbose",
          "-f", "prisma/migrations/0005_b12_aftersale_refund_guards/migration.sql",
        ],
        {
          env: postgresEnvironment(migrator),
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      if (failure.error) throw failure.error;
      if (failure.status === 0) {
        throw new Error(`B12 migration accepted ${scenario.name}`);
      }
      if (!failure.stderr.includes(scenario.expectedError) || !/ERROR:\s+23505:/.test(failure.stderr)) {
        throw new Error(`B12 migration failed unexpectedly while testing ${scenario.name}`);
      }

      const residue = runPsql(replay, [
        "-Atqc",
        `SELECT
           (SELECT count(*) FROM pg_class WHERE relkind = 'i'
             AND relname IN (${indexNames.map((name) => `'${name}'`).join(", ")}))
           +
           (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'enforce_refund_envelope')
           +
           (SELECT count(*) FROM pg_trigger WHERE tgname IN (
             'trg_refund_envelope_parent', 'trg_refund_envelope_items'
           ))`,
      ], undefined, true);
      if (residue !== "0") {
        throw new Error(`B12 migration failure left schema residue while testing ${scenario.name}`);
      }
    } finally {
      runPsql(replay, [], scenario.cleanup);
    }
  }

  const manualFixture = {
    compensation: "01J00000000000000000000201",
    customer: "01J00000000000000000000202",
    firstCategory: "01J00000000000000000000203",
    firstItem: "01J00000000000000000000204",
    firstProduct: "01J00000000000000000000205",
    firstSku: "01J00000000000000000000206",
    order: "01J00000000000000000000207",
    refund: "01J00000000000000000000208",
    refundItem: "01J00000000000000000000209",
    secondCategory: "01J0000000000000000000020A",
    secondItem: "01J0000000000000000000020B",
    secondProduct: "01J0000000000000000000020C",
    secondSku: "01J0000000000000000000020D",
  };
  runPsql(replay, [], `
    SET session_replication_role = replica;
    INSERT INTO public.sales_order (
      id, order_no, customer_id, source, goods_amount, payable_amount,
      paid_amount, created_at, pay_expires_at, updated_at
    ) VALUES (
      '${manualFixture.order}', 'QXB12PREFLIGHT001', '${manualFixture.customer}', 'BUY_NOW',
      10.00, 10.00, 10.00, '2026-09-01T00:00:00Z', '2026-09-01T00:30:00Z',
      '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.order_item (
      id, order_id, product_id, category_id, sku_id, product_name_snapshot,
      brand_name_snapshot, category_name_snapshot, sku_name_snapshot, sku_code_snapshot,
      unit_price, quantity, line_paid_amount
    ) VALUES
      ('${manualFixture.firstItem}', '${manualFixture.order}', '${manualFixture.firstProduct}',
       '${manualFixture.firstCategory}', '${manualFixture.firstSku}', 'B12 preflight one',
       'B12 brand', 'B12 category', 'B12 SKU one', 'B12-PREFLIGHT-1', 5.00, 1, 5.00),
      ('${manualFixture.secondItem}', '${manualFixture.order}', '${manualFixture.secondProduct}',
       '${manualFixture.secondCategory}', '${manualFixture.secondSku}', 'B12 preflight two',
       'B12 brand', 'B12 category', 'B12 SKU two', 'B12-PREFLIGHT-2', 5.00, 1, 5.00);
    INSERT INTO public.manual_compensation (
      id, compensation_no, order_id, order_item_id, customer_id, approved_by_id,
      amount, reserved_amount, reason, updated_at
    ) VALUES (
      '${manualFixture.compensation}', 'MCB12PREFLIGHT01', '${manualFixture.order}',
      '${manualFixture.firstItem}', '${manualFixture.customer}',
      '01J0000000000000000000020E', 5.00, 5.00, 'B12 migration preflight fixture',
      '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.refund (
      id, refund_no, order_id, manual_compensation_id, origin_type, provider,
      amount, reason, updated_at
    ) VALUES (
      '${manualFixture.refund}', 'RFB12PREFLIGHT01', '${manualFixture.order}',
      '${manualFixture.compensation}', 'MANUAL_COMPENSATION', 'MOCK', 5.00,
      'B12 migration preflight fixture', '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.refund_item (
      id, refund_id, order_item_id, quantity, amount
    ) VALUES (
      '${manualFixture.refundItem}', '${manualFixture.refund}',
      '${manualFixture.secondItem}', 1, 5.00
    );
    SET session_replication_role = origin;
  `);
  try {
    const failure = spawnSync(
      "psql",
      [
        "-X",
        "-v", "ON_ERROR_STOP=1",
        "--set=VERBOSITY=verbose",
        "-f", "prisma/migrations/0005_b12_aftersale_refund_guards/migration.sql",
      ],
      {
        env: postgresEnvironment(migrator),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    if (failure.error) throw failure.error;
    if (failure.status === 0 ||
      !failure.stderr.includes("refund item contains an invalid order or aftersale envelope") ||
      !/ERROR:\s+23514:/.test(failure.stderr)) {
      throw new Error("B12 migration did not reject a cross-item manual-compensation envelope");
    }
    const residue = runPsql(replay, [
      "-Atqc",
      `SELECT
         (SELECT count(*) FROM pg_class WHERE relkind = 'i'
           AND relname IN (${indexNames.map((name) => `'${name}'`).join(", ")}))
         +
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'enforce_refund_envelope')
         +
         (SELECT count(*) FROM pg_trigger WHERE tgname IN (
           'trg_refund_envelope_parent', 'trg_refund_envelope_items'
         ))`,
    ], undefined, true);
    if (residue !== "0") {
      throw new Error("B12 manual-compensation preflight failure left schema residue");
    }
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.refund_item WHERE id = '${manualFixture.refundItem}';
      DELETE FROM public.refund WHERE id = '${manualFixture.refund}';
      DELETE FROM public.manual_compensation WHERE id = '${manualFixture.compensation}';
      DELETE FROM public.order_item
      WHERE id IN ('${manualFixture.firstItem}', '${manualFixture.secondItem}');
      DELETE FROM public.sales_order WHERE id = '${manualFixture.order}';
      SET session_replication_role = origin;
    `);
  }
  console.log("B12 refund-attempt and manual-compensation preflights failed atomically as expected");
}

function verifyB13MigrationFailurePaths(replay, migrator) {
  const orphanAccountId = "01J00000000000000000000301";
  const forged = {
    account: "01J00000000000000000000302",
    agent: "01J00000000000000000000303",
    bank: "01J00000000000000000000304",
    withdrawal: "01J00000000000000000000305",
    bankSnapshot: "01J00000000000000000000306",
  };
  const invalidPromotion = {
    account: "01J00000000000000000000307",
    agent: "01J00000000000000000000308",
    invite: "01J00000000000000000000309",
    promotion: "01J0000000000000000000030A",
  };
  const invalidCommission = {
    firstAccount: "01J0000000000000000000030B",
    firstAgent: "01J0000000000000000000030C",
    secondAccount: "01J0000000000000000000030D",
    secondAgent: "01J0000000000000000000030E",
    order: "01J0000000000000000000030F",
    item: "01J0000000000000000000030G",
    snapshot: "01J0000000000000000000030H",
    ledger: "01J0000000000000000000030J",
  };
  const scenarios = [
    {
      name: "orphan AGENT_ADMIN account",
      predeployCheck: "agent-promotion",
      expectedError: "AGENT_ADMIN account and agent profile are not a complete one-to-one pair",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.account (id, role, updated_at)
        VALUES ('${orphanAccountId}', 'AGENT_ADMIN', CURRENT_TIMESTAMP);
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.account WHERE id = '${orphanAccountId}';
        SET session_replication_role = origin;
      `,
    },
    {
      name: "forged withdrawal bank snapshot",
      predeployCheck: "withdrawal-bank-snapshot",
      expectedError: "withdrawal bank snapshot contains an invalid immutable source envelope",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.account (id, role, updated_at)
        VALUES ('${forged.account}', 'AGENT_ADMIN', CURRENT_TIMESTAMP);
        INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
        VALUES ('${forged.agent}', '${forged.account}', 'B13-PREFLIGHT', 'B13 preflight agent', CURRENT_TIMESTAMP);
        INSERT INTO public.agent_bank_account (
          id, agent_id, account_holder, bank_name, account_no_ciphertext,
          account_no_hash, account_no_last4, encryption_key_id, updated_at
        ) VALUES (
          '${forged.bank}', '${forged.agent}', 'B13 source holder', 'B13 fixture bank',
          decode('aabbccdd', 'hex'), repeat('a', 64), '1234', 'b13-field-key', CURRENT_TIMESTAMP
        );
        INSERT INTO public.withdrawal (
          id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
        ) VALUES (
          '${forged.withdrawal}', 'WDB13PREFLIGHT001', '${forged.agent}',
          10.00, 20.00, 10.00, CURRENT_TIMESTAMP
        );
        INSERT INTO public.withdrawal_bank_snapshot (
          id, withdrawal_id, source_bank_account_id, account_holder, bank_name,
          account_no_ciphertext, account_no_last4, encryption_key_id
        ) VALUES (
          '${forged.bankSnapshot}', '${forged.withdrawal}', '${forged.bank}',
          'B13 forged holder', 'B13 fixture bank', decode('aabbccdd', 'hex'),
          '1234', 'b13-field-key'
        );
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.withdrawal_bank_snapshot WHERE id = '${forged.bankSnapshot}';
        DELETE FROM public.withdrawal WHERE id = '${forged.withdrawal}';
        DELETE FROM public.agent_bank_account WHERE id = '${forged.bank}';
        DELETE FROM public.agent_profile WHERE id = '${forged.agent}';
        DELETE FROM public.account WHERE id = '${forged.account}';
        SET session_replication_role = origin;
      `,
    },
    {
      name: "invalid active promotion lifecycle",
      predeployCheck: "agent-promotion",
      expectedError: "promotion asset contains an invalid target, lifecycle, or agent envelope",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.account (id, role, updated_at)
        VALUES ('${invalidPromotion.account}', 'AGENT_ADMIN', CURRENT_TIMESTAMP);
        INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
        VALUES (
          '${invalidPromotion.agent}', '${invalidPromotion.account}',
          'B13-PREFLIGHT-PROMO', 'B13 preflight promotion agent', CURRENT_TIMESTAMP
        );
        INSERT INTO public.agent_invite_code (
          id, agent_id, code_hash, code_ciphertext, code_last4, encryption_key_id
        ) VALUES (
          '${invalidPromotion.invite}', '${invalidPromotion.agent}', repeat('b', 64),
          decode('11223344', 'hex'), '5678', 'b13-invite-key'
        );
        INSERT INTO public.promotion_asset (
          id, agent_id, invite_code_id, target_type, status,
          authorization_version, public_url, revoked_at
        ) VALUES (
          '${invalidPromotion.promotion}', '${invalidPromotion.agent}', '${invalidPromotion.invite}',
          'STOREFRONT', 'ACTIVE', 1, 'https://store.example.invalid/invalid', CURRENT_TIMESTAMP
        );
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.promotion_asset WHERE id = '${invalidPromotion.promotion}';
        DELETE FROM public.agent_invite_code WHERE id = '${invalidPromotion.invite}';
        DELETE FROM public.agent_profile WHERE id = '${invalidPromotion.agent}';
        DELETE FROM public.account WHERE id = '${invalidPromotion.account}';
        SET session_replication_role = origin;
      `,
    },
    {
      name: "invalid commission ledger balance envelope",
      predeployCheck: "commission-ledger",
      expectedError: "commission ledger contains an invalid reference or balance-change envelope",
      setup: `
        SET session_replication_role = replica;
        INSERT INTO public.account (id, role, updated_at) VALUES
          ('${invalidCommission.firstAccount}', 'AGENT_ADMIN', CURRENT_TIMESTAMP),
          ('${invalidCommission.secondAccount}', 'AGENT_ADMIN', CURRENT_TIMESTAMP);
        INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at) VALUES
          ('${invalidCommission.firstAgent}', '${invalidCommission.firstAccount}',
           'B13-PREFLIGHT-COMM-1', 'B13 commission agent one', CURRENT_TIMESTAMP),
          ('${invalidCommission.secondAgent}', '${invalidCommission.secondAccount}',
           'B13-PREFLIGHT-COMM-2', 'B13 commission agent two', CURRENT_TIMESTAMP);
        INSERT INTO public.sales_order (
          id, order_no, customer_id, source, final_channel, final_agent_id,
          goods_amount, payable_amount, paid_amount, created_at, pay_expires_at, updated_at
        ) VALUES (
          '${invalidCommission.order}', 'QXB13PREFLIGHT001',
          '01J0000000000000000000030K', 'BUY_NOW', 'AGENT', '${invalidCommission.firstAgent}',
          10.00, 10.00, 10.00, '2026-09-02T00:00:00Z',
          '2026-09-02T00:30:00Z', '2026-09-02T00:00:00Z'
        );
        INSERT INTO public.order_item (
          id, order_id, product_id, category_id, sku_id, product_name_snapshot,
          brand_name_snapshot, category_name_snapshot, sku_name_snapshot,
          sku_code_snapshot, unit_price, quantity, line_paid_amount
        ) VALUES (
          '${invalidCommission.item}', '${invalidCommission.order}',
          '01J0000000000000000000030M', '01J0000000000000000000030N',
          '01J0000000000000000000030P', 'B13 preflight item', 'B13 brand',
          'B13 category', 'B13 SKU', 'B13-PREFLIGHT-SKU', 10.00, 1, 10.00
        );
        INSERT INTO public.order_item_commission_snapshot (
          id, order_item_id, agent_id, rule_version_id, source_type,
          category_id_snapshot, category_name_snapshot, product_id_snapshot,
          sku_id_snapshot, effective_rate, commission_base, original_commission
        ) VALUES (
          '${invalidCommission.snapshot}', '${invalidCommission.item}', '${invalidCommission.firstAgent}',
          '01J0000000000000000000030Q', 'PLATFORM', '01J0000000000000000000030N',
          'B13 category', '01J0000000000000000000030M', '01J0000000000000000000030P',
          10.0000, 10.00, 1.00
        );
        INSERT INTO public.commission_ledger (
          id, agent_id, snapshot_id, ledger_type, expected_change,
          available_change, frozen_change, reason, idempotency_key
        ) VALUES (
          '${invalidCommission.ledger}', '${invalidCommission.firstAgent}',
          '${invalidCommission.snapshot}', 'EXPECTED_CREATED', 1.00, 1.00, 0.00,
          'B13 invalid preflight ledger', 'b13-invalid-preflight-ledger'
        );
        SET session_replication_role = origin;
      `,
      cleanup: `
        SET session_replication_role = replica;
        DELETE FROM public.commission_ledger WHERE id = '${invalidCommission.ledger}';
        DELETE FROM public.order_item_commission_snapshot WHERE id = '${invalidCommission.snapshot}';
        DELETE FROM public.order_item WHERE id = '${invalidCommission.item}';
        DELETE FROM public.sales_order WHERE id = '${invalidCommission.order}';
        DELETE FROM public.agent_profile
        WHERE id IN ('${invalidCommission.firstAgent}', '${invalidCommission.secondAgent}');
        DELETE FROM public.account
        WHERE id IN ('${invalidCommission.firstAccount}', '${invalidCommission.secondAccount}');
        SET session_replication_role = origin;
      `,
    },
  ];

  for (const scenario of scenarios) {
    runPsql(replay, [], scenario.setup);
    try {
      const failedPredeployChecks = B13_PREDEPLOY_CHECKS
        .filter((check) => runPsql(replay, ["-Atqc", check.sql], undefined, true) !== "0")
        .map((check) => check.key);
      if (!failedPredeployChecks.includes(scenario.predeployCheck)) {
        throw new Error(
          `B13 shared pre-deploy predicates missed ${scenario.name}: ${failedPredeployChecks.join(",")}`,
        );
      }
      const predeployHistory = runPsql(replay, [
        "-Atqc",
        `SELECT count(*) FROM public._prisma_migrations
         WHERE migration_name = '0006_b13_agent_finance_guards'`,
      ], undefined, true);
      if (predeployHistory !== "0") {
        throw new Error(`B13 pre-deploy predicate left history residue for ${scenario.name}`);
      }

      const failure = spawnSync(
        "psql",
        [
          "-X",
          "-v", "ON_ERROR_STOP=1",
          "--set=VERBOSITY=verbose",
          "-f", "prisma/migrations/0006_b13_agent_finance_guards/migration.sql",
        ],
        {
          env: postgresEnvironment(migrator),
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      if (failure.error) throw failure.error;
      if (failure.status === 0) throw new Error(`B13 migration accepted ${scenario.name}`);
      if (!failure.stderr.includes(scenario.expectedError) || !/ERROR:\s+23514:/.test(failure.stderr)) {
        throw new Error(`B13 migration failed unexpectedly while testing ${scenario.name}`);
      }

      const residue = runPsql(replay, [
        "-Atqc",
        `SELECT
           (SELECT count(*) FROM pg_class WHERE relkind = 'i'
             AND relname = 'uq_commission_ledger_withdrawal_type')
           + (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'chk_b13_%')
           + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND (p.proname LIKE 'enforce_b13_%' OR p.proname LIKE 'guard_b13_%'))
           + (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_b13_%')
           + (SELECT count(*) FROM public._prisma_migrations
             WHERE migration_name = '0006_b13_agent_finance_guards')`,
      ], undefined, true);
      if (residue !== "0") {
        throw new Error(`B13 migration failure left schema or history residue for ${scenario.name}`);
      }
    } finally {
      runPsql(replay, [], scenario.cleanup);
    }
  }
  const historicalResidue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.withdrawal_bank_snapshot WHERE id = '${forged.bankSnapshot}'
       UNION ALL SELECT id FROM public.withdrawal WHERE id = '${forged.withdrawal}'
       UNION ALL SELECT id FROM public.agent_bank_account WHERE id = '${forged.bank}'
       UNION ALL SELECT id FROM public.promotion_asset WHERE id = '${invalidPromotion.promotion}'
       UNION ALL SELECT id FROM public.agent_invite_code WHERE id = '${invalidPromotion.invite}'
       UNION ALL SELECT id FROM public.commission_ledger WHERE id = '${invalidCommission.ledger}'
       UNION ALL SELECT id FROM public.order_item_commission_snapshot
       WHERE id = '${invalidCommission.snapshot}'
       UNION ALL SELECT id FROM public.order_item WHERE id = '${invalidCommission.item}'
       UNION ALL SELECT id FROM public.sales_order WHERE id = '${invalidCommission.order}'
       UNION ALL SELECT id FROM public.agent_profile WHERE id IN (
         '${forged.agent}', '${invalidPromotion.agent}',
         '${invalidCommission.firstAgent}', '${invalidCommission.secondAgent}'
       )
       UNION ALL SELECT id FROM public.account WHERE id IN (
         '${orphanAccountId}', '${forged.account}', '${invalidPromotion.account}',
         '${invalidCommission.firstAccount}', '${invalidCommission.secondAccount}'
       )
     ) AS fixture_residue`,
  ], undefined, true);
  if (historicalResidue !== "0") {
    throw new Error("B13 migration failure-path tests left historical fixture residue");
  }
  console.log(
    "B13 Agent, bank-snapshot, promotion and commission preflights failed atomically as expected",
  );
}

async function verifyB12RefundGuards(replay) {
  const fixtureIds = {
    firstOrder: "01J00000000000000000000101",
    firstCustomer: "01J00000000000000000000102",
    firstOrderItem: "01J00000000000000000000103",
    firstProduct: "01J00000000000000000000104",
    firstCategory: "01J00000000000000000000105",
    firstSku: "01J00000000000000000000106",
    aftersale: "01J00000000000000000000107",
    aftersaleItem: "01J00000000000000000000108",
    inspection: "01J00000000000000000000109",
    inspector: "01J0000000000000000000010A",
    inspectionItem: "01J0000000000000000000010B",
    secondOrder: "01J0000000000000000000010C",
    secondCustomer: "01J0000000000000000000010D",
    secondOrderItem: "01J0000000000000000000010E",
    secondProduct: "01J0000000000000000000010F",
    secondCategory: "01J0000000000000000000010G",
    secondSku: "01J0000000000000000000010H",
    aftersaleRefund: "01J0000000000000000000010J",
    aftersaleRefundItem: "01J0000000000000000000010K",
    invalidEnvelopeRefund: "01J0000000000000000000010M",
    invalidAmountRefund: "01J0000000000000000000010N",
    invalidAmountItem: "01J0000000000000000000010P",
    lateRefund: "01J0000000000000000000010Q",
    lateRefundItem: "01J0000000000000000000010R",
    secondOrderItemAlt: "01J00000000000000000000110",
    secondProductAlt: "01J00000000000000000000111",
    secondCategoryAlt: "01J00000000000000000000112",
    secondSkuAlt: "01J00000000000000000000113",
    manualCompensation: "01J00000000000000000000114",
    invalidManualRefund: "01J00000000000000000000115",
    invalidManualRefundItem: "01J00000000000000000000116",
    manualRefund: "01J00000000000000000000117",
    manualRefundItem: "01J00000000000000000000118",
    invalidManualQuantityRefund: "01J0000000000000000000011P",
    invalidManualQuantityRefundItem: "01J0000000000000000000011Q",
    concurrentOrder: "01J00000000000000000000119",
    concurrentCustomer: "01J0000000000000000000011A",
    concurrentOrderItemOne: "01J0000000000000000000011B",
    concurrentProductOne: "01J0000000000000000000011C",
    concurrentCategoryOne: "01J0000000000000000000011D",
    concurrentSkuOne: "01J0000000000000000000011E",
    concurrentOrderItemTwo: "01J0000000000000000000011F",
    concurrentProductTwo: "01J0000000000000000000011G",
    concurrentCategoryTwo: "01J0000000000000000000011H",
    concurrentSkuTwo: "01J0000000000000000000011J",
    concurrentRefund: "01J0000000000000000000011K",
    concurrentRefundItemOne: "01J0000000000000000000011M",
    concurrentRefundItemTwo: "01J0000000000000000000011N",
  };

  runPsql(replay, [], `
    SET session_replication_role = replica;
    INSERT INTO public.sales_order (
      id, order_no, customer_id, source, goods_amount, payable_amount,
      paid_amount, created_at, pay_expires_at, updated_at
    ) VALUES
      ('${fixtureIds.firstOrder}', 'QXB12RUNTIME0001', '${fixtureIds.firstCustomer}', 'BUY_NOW',
       10.00, 10.00, 10.00, '2026-09-01T00:00:00Z', '2026-09-01T00:30:00Z', '2026-09-01T00:00:00Z'),
      ('${fixtureIds.secondOrder}', 'QXB12RUNTIME0002', '${fixtureIds.secondCustomer}', 'BUY_NOW',
       13.00, 13.00, 13.00, '2026-09-01T00:00:00Z', '2026-09-01T00:30:00Z', '2026-09-01T00:00:00Z'),
      ('${fixtureIds.concurrentOrder}', 'QXB12RUNTIME0003', '${fixtureIds.concurrentCustomer}', 'BUY_NOW',
       14.00, 14.00, 14.00, '2026-09-01T00:00:00Z', '2026-09-01T00:30:00Z', '2026-09-01T00:00:00Z');
    INSERT INTO public.order_item (
      id, order_id, product_id, category_id, sku_id, product_name_snapshot,
      brand_name_snapshot, category_name_snapshot, sku_name_snapshot, sku_code_snapshot,
      unit_price, quantity, line_paid_amount, aftersale_reserved_qty, aftersale_reserved_amount
    ) VALUES
      ('${fixtureIds.firstOrderItem}', '${fixtureIds.firstOrder}', '${fixtureIds.firstProduct}',
       '${fixtureIds.firstCategory}', '${fixtureIds.firstSku}', 'B12 fixture one', 'B12 brand',
       'B12 category', 'B12 SKU one', 'B12-SKU-1', 10.00, 1, 10.00, 1, 10.00),
      ('${fixtureIds.secondOrderItem}', '${fixtureIds.secondOrder}', '${fixtureIds.secondProduct}',
       '${fixtureIds.secondCategory}', '${fixtureIds.secondSku}', 'B12 fixture two', 'B12 brand',
       'B12 category', 'B12 SKU two', 'B12-SKU-2', 9.00, 1, 9.00, 0, 0.00),
      ('${fixtureIds.secondOrderItemAlt}', '${fixtureIds.secondOrder}', '${fixtureIds.secondProductAlt}',
       '${fixtureIds.secondCategoryAlt}', '${fixtureIds.secondSkuAlt}', 'B12 fixture two alt', 'B12 brand',
       'B12 category', 'B12 SKU two alt', 'B12-SKU-2A', 4.00, 1, 4.00, 0, 0.00),
      ('${fixtureIds.concurrentOrderItemOne}', '${fixtureIds.concurrentOrder}',
       '${fixtureIds.concurrentProductOne}', '${fixtureIds.concurrentCategoryOne}',
       '${fixtureIds.concurrentSkuOne}', 'B12 concurrent one', 'B12 brand', 'B12 category',
       'B12 concurrent SKU one', 'B12-CONCURRENT-1', 7.00, 1, 7.00, 0, 0.00),
      ('${fixtureIds.concurrentOrderItemTwo}', '${fixtureIds.concurrentOrder}',
       '${fixtureIds.concurrentProductTwo}', '${fixtureIds.concurrentCategoryTwo}',
       '${fixtureIds.concurrentSkuTwo}', 'B12 concurrent two', 'B12 brand', 'B12 category',
       'B12 concurrent SKU two', 'B12-CONCURRENT-2', 7.00, 1, 7.00, 0, 0.00);
    INSERT INTO public.aftersale (
      id, aftersale_no, order_id, customer_id, type, reason_code, updated_at
    ) VALUES (
      '${fixtureIds.aftersale}', 'ASB12RUNTIME0001', '${fixtureIds.firstOrder}',
      '${fixtureIds.firstCustomer}', 'RETURN_REFUND', 'DAMAGED', '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.aftersale_item (
      id, aftersale_id, order_item_id, requested_qty, requested_amount,
      reserved_qty, reserved_amount
    ) VALUES (
      '${fixtureIds.aftersaleItem}', '${fixtureIds.aftersale}',
      '${fixtureIds.firstOrderItem}', 1, 10.00, 1, 10.00
    );
    INSERT INTO public.return_inspection (
      id, aftersale_id, status, inspected_by_id, evidence_manifest, evidence_count,
      inspected_at, updated_at
    ) VALUES (
      '${fixtureIds.inspection}', '${fixtureIds.aftersale}', 'PASS', '${fixtureIds.inspector}',
      '[]', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.return_inspection_item (
      id, inspection_id, order_item_id, received_qty, approved_refund_qty, restock_qty
    ) VALUES (
      '${fixtureIds.inspectionItem}', '${fixtureIds.inspection}',
      '${fixtureIds.firstOrderItem}', 1, 1, 1
    );
    INSERT INTO public.manual_compensation (
      id, compensation_no, order_id, order_item_id, customer_id, approved_by_id,
      amount, reserved_amount, reason, updated_at
    ) VALUES (
      '${fixtureIds.manualCompensation}', 'MCB12RUNTIME0001', '${fixtureIds.secondOrder}',
      '${fixtureIds.secondOrderItemAlt}', '${fixtureIds.secondCustomer}', '${fixtureIds.inspector}',
      4.00, 4.00, 'B12 manual compensation fixture', '2026-09-01T00:00:00Z'
    );
    INSERT INTO public.refund (
      id, refund_no, order_id, origin_type, provider, amount, reason,
      is_late_payment_refund, updated_at
    ) VALUES (
      '${fixtureIds.concurrentRefund}', 'RFB12CONCURRENT1', '${fixtureIds.concurrentOrder}',
      'LATE_PAYMENT', 'MOCK', 7.00, 'B12 concurrent serialization fixture', TRUE,
      '2026-09-01T00:00:00Z'
    );
    SET session_replication_role = origin;
  `);

  try {
    expectPsqlFailure(replay, `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, aftersale_id, origin_type, provider, amount, reason, updated_at
      ) VALUES (
        '${fixtureIds.invalidEnvelopeRefund}', 'RFB12INVALID0001', '${fixtureIds.secondOrder}',
        '${fixtureIds.aftersale}', 'AFTERSALE', 'MOCK', 10.00, 'B12 invalid envelope',
        '2026-09-01T00:00:00Z'
      );
      COMMIT;
    `, "refund aftersale must belong to the same order and customer", "B12 cross-customer refund envelope");

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, aftersale_id, origin_type, provider, amount, reason, updated_at
      ) VALUES (
        '${fixtureIds.aftersaleRefund}', 'RFB12RUNTIME0001', '${fixtureIds.firstOrder}',
        '${fixtureIds.aftersale}', 'AFTERSALE', 'MOCK', 10.00, 'B12 runtime fixture',
        '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, aftersale_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.aftersaleRefundItem}', '${fixtureIds.aftersaleRefund}',
        '${fixtureIds.firstOrderItem}', '${fixtureIds.aftersaleItem}', 1, 10.00
      );
      COMMIT;
    `);

    expectPsqlFailure(replay, `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, manual_compensation_id, origin_type, provider,
        amount, reason, updated_at
      ) VALUES (
        '${fixtureIds.invalidManualRefund}', 'RFB12INVALID0003', '${fixtureIds.secondOrder}',
        '${fixtureIds.manualCompensation}', 'MANUAL_COMPENSATION', 'MOCK', 4.00,
        'B12 cross-item compensation fixture', '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.invalidManualRefundItem}', '${fixtureIds.invalidManualRefund}',
        '${fixtureIds.secondOrderItem}', 1, 4.00
      );
      COMMIT;
    `, "refund items must belong to the refund order and aftersale", "B12 cross-item compensation");

    expectPsqlFailure(replay, `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, manual_compensation_id, origin_type, provider,
        amount, reason, updated_at
      ) VALUES (
        '${fixtureIds.invalidManualQuantityRefund}', 'RFB12INVALID0004', '${fixtureIds.secondOrder}',
        '${fixtureIds.manualCompensation}', 'MANUAL_COMPENSATION', 'MOCK', 4.00,
        'B12 compensation quantity fixture', '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.invalidManualQuantityRefundItem}', '${fixtureIds.invalidManualQuantityRefund}',
        '${fixtureIds.secondOrderItemAlt}', 2, 4.00
      );
      COMMIT;
    `, "refund items must belong to the refund order and aftersale", "B12 compensation quantity marker");

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, manual_compensation_id, origin_type, provider,
        amount, reason, updated_at
      ) VALUES (
        '${fixtureIds.manualRefund}', 'RFB12RUNTIME0002', '${fixtureIds.secondOrder}',
        '${fixtureIds.manualCompensation}', 'MANUAL_COMPENSATION', 'MOCK', 4.00,
        'B12 valid compensation fixture', '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.manualRefundItem}', '${fixtureIds.manualRefund}',
        '${fixtureIds.secondOrderItemAlt}', 1, 4.00
      );
      COMMIT;
    `);

    expectPsqlFailure(replay, `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, origin_type, provider, amount, reason,
        is_late_payment_refund, updated_at
      ) VALUES (
        '${fixtureIds.invalidAmountRefund}', 'RFB12INVALID0002', '${fixtureIds.secondOrder}',
        'LATE_PAYMENT', 'MOCK', 9.00, 'B12 invalid amount', TRUE, '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.invalidAmountItem}', '${fixtureIds.invalidAmountRefund}',
        '${fixtureIds.secondOrderItem}', 1, 8.00
      );
      COMMIT;
    `, "refund amount must equal the sum of its items", "B12 refund item total");

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund (
        id, refund_no, order_id, origin_type, provider, amount, reason,
        is_late_payment_refund, updated_at
      ) VALUES (
        '${fixtureIds.lateRefund}', 'RFB12LATE000001', '${fixtureIds.secondOrder}',
        'LATE_PAYMENT', 'MOCK', 9.00, 'B12 late-payment fixture', TRUE,
        '2026-09-01T00:00:00Z'
      );
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.lateRefundItem}', '${fixtureIds.lateRefund}',
        '${fixtureIds.secondOrderItem}', 1, 9.00
      );
      COMMIT;
    `);

    const firstConcurrentWrite = runPsqlAsync(replay, `
      SET application_name = 'b12-refund-guard-first';
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.concurrentRefundItemOne}', '${fixtureIds.concurrentRefund}',
        '${fixtureIds.concurrentOrderItemOne}', 1, 7.00
      );
      SELECT pg_sleep(2);
      COMMIT;
    `);
    waitForSleepingApplication(replay, "b12-refund-guard-first");
    const secondConcurrentWrite = runPsqlAsync(replay, `
      SET statement_timeout = '6s';
      BEGIN;
      SET LOCAL ROLE mall_runtime;
      INSERT INTO public.refund_item (
        id, refund_id, order_item_id, quantity, amount
      ) VALUES (
        '${fixtureIds.concurrentRefundItemTwo}', '${fixtureIds.concurrentRefund}',
        '${fixtureIds.concurrentOrderItemTwo}', 1, 7.00
      );
      COMMIT;
    `);
    const [firstResult, secondResult] = await Promise.all([
      firstConcurrentWrite,
      secondConcurrentWrite,
    ]);
    if (firstResult.status !== 0) {
      throw new Error("B12 first serialized refund-item writer failed");
    }
    if (secondResult.status === 0 ||
      !secondResult.stderr.includes("refund amount must equal the sum of its items")) {
      throw new Error("B12 concurrent refund-item writers did not serialize on the parent refund");
    }

    runPsql(replay, [], `
      BEGIN;
      DELETE FROM public.refund_item
      WHERE id IN (
        '${fixtureIds.aftersaleRefundItem}', '${fixtureIds.lateRefundItem}',
        '${fixtureIds.manualRefundItem}', '${fixtureIds.concurrentRefundItemOne}'
      );
      DELETE FROM public.refund
      WHERE id IN (
        '${fixtureIds.aftersaleRefund}', '${fixtureIds.lateRefund}',
        '${fixtureIds.manualRefund}', '${fixtureIds.concurrentRefund}'
      );
      COMMIT;
    `);
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.refund_attempt
      WHERE refund_id IN (
        '${fixtureIds.aftersaleRefund}', '${fixtureIds.invalidEnvelopeRefund}',
        '${fixtureIds.invalidAmountRefund}', '${fixtureIds.lateRefund}',
        '${fixtureIds.invalidManualRefund}', '${fixtureIds.invalidManualQuantityRefund}',
        '${fixtureIds.manualRefund}',
        '${fixtureIds.concurrentRefund}'
      );
      DELETE FROM public.refund_item
      WHERE refund_id IN (
        '${fixtureIds.aftersaleRefund}', '${fixtureIds.invalidEnvelopeRefund}',
        '${fixtureIds.invalidAmountRefund}', '${fixtureIds.lateRefund}',
        '${fixtureIds.invalidManualRefund}', '${fixtureIds.invalidManualQuantityRefund}',
        '${fixtureIds.manualRefund}',
        '${fixtureIds.concurrentRefund}'
      );
      DELETE FROM public.refund
      WHERE id IN (
        '${fixtureIds.aftersaleRefund}', '${fixtureIds.invalidEnvelopeRefund}',
        '${fixtureIds.invalidAmountRefund}', '${fixtureIds.lateRefund}',
        '${fixtureIds.invalidManualRefund}', '${fixtureIds.invalidManualQuantityRefund}',
        '${fixtureIds.manualRefund}',
        '${fixtureIds.concurrentRefund}'
      );
      DELETE FROM public.manual_compensation WHERE id = '${fixtureIds.manualCompensation}';
      DELETE FROM public.return_inspection_item WHERE id = '${fixtureIds.inspectionItem}';
      DELETE FROM public.return_inspection WHERE id = '${fixtureIds.inspection}';
      DELETE FROM public.aftersale_item WHERE id = '${fixtureIds.aftersaleItem}';
      DELETE FROM public.aftersale WHERE id = '${fixtureIds.aftersale}';
      DELETE FROM public.order_item
      WHERE id IN (
        '${fixtureIds.firstOrderItem}', '${fixtureIds.secondOrderItem}',
        '${fixtureIds.secondOrderItemAlt}', '${fixtureIds.concurrentOrderItemOne}',
        '${fixtureIds.concurrentOrderItemTwo}'
      );
      DELETE FROM public.sales_order
      WHERE id IN (
        '${fixtureIds.firstOrder}', '${fixtureIds.secondOrder}', '${fixtureIds.concurrentOrder}'
      );
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.refund WHERE id IN (
         '${fixtureIds.aftersaleRefund}', '${fixtureIds.invalidEnvelopeRefund}',
         '${fixtureIds.invalidAmountRefund}', '${fixtureIds.lateRefund}',
         '${fixtureIds.invalidManualRefund}', '${fixtureIds.invalidManualQuantityRefund}',
         '${fixtureIds.manualRefund}',
         '${fixtureIds.concurrentRefund}'
       )
       UNION ALL
       SELECT id FROM public.sales_order WHERE id IN (
         '${fixtureIds.firstOrder}', '${fixtureIds.secondOrder}', '${fixtureIds.concurrentOrder}'
       )
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("B12 refund guard test left fixture residue");
  console.log(
    "B12 mall_runtime refund envelopes, compensation binding, parent serialization, cleanup and B10 late-refund path verified",
  );
}

async function verifyB13AgentRoleRace(replay) {
  const runtime = { ...replay, username: "mall_runtime", password: `${replay.password}-runtime` };
  const ids = {
    raceAccount: "01J00000000000000000000311",
    raceAgent: "01J00000000000000000000312",
    validAccount: "01J00000000000000000000313",
    validAgent: "01J00000000000000000000314",
  };

  runPsql(runtime, [], `
    INSERT INTO public.account (id, role, updated_at)
    VALUES ('${ids.raceAccount}', 'CUSTOMER', CURRENT_TIMESTAMP);
  `);
  try {
    const roleChange = runPsqlAsync(runtime, `
      SET application_name = 'b13-agent-role-change';
      BEGIN;
      UPDATE public.account
      SET role = 'AGENT_ADMIN', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.raceAccount}';
      SELECT pg_sleep(2);
      COMMIT;
    `);
    waitForSleepingApplication(replay, "b13-agent-role-change");
    const profileInsert = runPsqlAsync(runtime, `
      SET statement_timeout = '6s';
      BEGIN;
      INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
      VALUES (
        '${ids.raceAgent}', '${ids.raceAccount}', 'B13-RACE',
        'B13 role race agent', CURRENT_TIMESTAMP
      );
      COMMIT;
    `);
    const [roleResult, profileResult] = await Promise.all([roleChange, profileInsert]);
    if (roleResult.status === 0 ||
      !roleResult.stderr.includes("AGENT_ADMIN account and agent profile must form a complete one-to-one pair")) {
      throw new Error("B13 role change committed without its required AgentProfile");
    }
    if (profileResult.status === 0 ||
      !profileResult.stderr.includes("agent profile account must have the AGENT_ADMIN role")) {
      throw new Error("B13 AgentProfile insert escaped the concurrent account-role lock");
    }
    const raceState = runPsql(replay, [
      "-Atqc",
      `SELECT concat_ws('|', a.role, count(ap.id))
       FROM public.account a
       LEFT JOIN public.agent_profile ap ON ap.account_id = a.id
       WHERE a.id = '${ids.raceAccount}'
       GROUP BY a.role`,
    ], undefined, true);
    if (raceState !== "CUSTOMER|0") {
      throw new Error(`B13 Agent role race left an invalid committed state: ${raceState}`);
    }

    runPsql(runtime, [], `
      BEGIN;
      INSERT INTO public.account (id, role, updated_at)
      VALUES ('${ids.validAccount}', 'AGENT_ADMIN', CURRENT_TIMESTAMP);
      INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
      VALUES (
        '${ids.validAgent}', '${ids.validAccount}', 'B13-VALID',
        'B13 valid agent', CURRENT_TIMESTAMP
      );
      COMMIT;
    `);
    expectPsqlFailure(runtime, `
      UPDATE public.agent_profile
      SET account_id = '${ids.raceAccount}', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.validAgent}';
    `, "agent profile account_id is immutable", "B13 AgentProfile account identity");

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_migrator;
      DELETE FROM public.agent_profile WHERE id = '${ids.validAgent}';
      DELETE FROM public.account WHERE id = '${ids.validAccount}';
      COMMIT;
    `);
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.agent_profile WHERE id IN ('${ids.raceAgent}', '${ids.validAgent}');
      DELETE FROM public.account WHERE id IN ('${ids.raceAccount}', '${ids.validAccount}');
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.agent_profile
       WHERE id IN ('${ids.raceAgent}', '${ids.validAgent}')
       UNION ALL
       SELECT id FROM public.account
       WHERE id IN ('${ids.raceAccount}', '${ids.validAccount}')
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("B13 Agent role race test left fixture residue");

  console.log("B13 Agent account/profile commit-time 1:1 and concurrent role serialization verified");
}

async function verifyB13CommissionGuards(replay) {
  const runtime = { ...replay, username: "mall_runtime", password: `${replay.password}-runtime` };
  const ids = {
    account: "01J00000000000000000000321",
    agent: "01J00000000000000000000322",
    firstOrder: "01J00000000000000000000323",
    secondOrder: "01J00000000000000000000324",
    orderItem: "01J00000000000000000000325",
    snapshot: "01J00000000000000000000326",
    rule: "01J00000000000000000000327",
    refund: "01J00000000000000000000328",
    refundLedger: "01J00000000000000000000329",
    otherAccount: "01J0000000000000000000032F",
    otherAgent: "01J0000000000000000000032G",
    crossAgentLedger: "01J0000000000000000000032H",
    crossOrderRefund: "01J0000000000000000000032J",
    crossOrderLedger: "01J0000000000000000000032K",
    firstCustomer: "01J0000000000000000000032A",
    secondCustomer: "01J0000000000000000000032B",
    firstCustomerAccount: "01J0000000000000000000032R",
    secondCustomerAccount: "01J0000000000000000000032S",
  };

  runPsql(replay, [], `
    SET session_replication_role = replica;
    INSERT INTO public.account (id, role, updated_at) VALUES
      ('${ids.account}', 'AGENT_ADMIN', CURRENT_TIMESTAMP),
      ('${ids.otherAccount}', 'AGENT_ADMIN', CURRENT_TIMESTAMP),
      ('${ids.firstCustomerAccount}', 'CUSTOMER', CURRENT_TIMESTAMP),
      ('${ids.secondCustomerAccount}', 'CUSTOMER', CURRENT_TIMESTAMP);
    INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at) VALUES
      ('${ids.agent}', '${ids.account}', 'B13-COMMISSION', 'B13 commission agent', CURRENT_TIMESTAMP),
      ('${ids.otherAgent}', '${ids.otherAccount}', 'B13-COMMISSION-2', 'B13 other agent', CURRENT_TIMESTAMP);
    INSERT INTO public.customer_profile (id, account_id, updated_at) VALUES
      ('${ids.firstCustomer}', '${ids.firstCustomerAccount}', CURRENT_TIMESTAMP),
      ('${ids.secondCustomer}', '${ids.secondCustomerAccount}', CURRENT_TIMESTAMP);
    INSERT INTO public.commission_rule_version (
      id, version_no, status, reason, created_by_id
    ) VALUES (
      '${ids.rule}', 9130001, 'DRAFT', 'B13 runtime snapshot fixture', '${ids.account}'
    );
    INSERT INTO public.sales_order (
      id, order_no, customer_id, source, final_channel, final_agent_id,
      goods_amount, payable_amount, paid_amount, created_at, pay_expires_at, updated_at
    ) VALUES
      ('${ids.firstOrder}', 'QXB13COMMISSION001', '${ids.firstCustomer}', 'BUY_NOW',
       'AGENT', '${ids.agent}', 10.00, 10.00, 10.00,
       '2026-09-02T00:00:00Z', '2026-09-02T00:30:00Z', '2026-09-02T00:00:00Z'),
      ('${ids.secondOrder}', 'QXB13COMMISSION002', '${ids.secondCustomer}', 'BUY_NOW',
       'DIRECT', NULL, 1.00, 1.00, 1.00,
       '2026-09-02T00:00:00Z', '2026-09-02T00:30:00Z', '2026-09-02T00:00:00Z');
    INSERT INTO public.order_item (
      id, order_id, product_id, category_id, sku_id, product_name_snapshot,
      brand_name_snapshot, category_name_snapshot, sku_name_snapshot, sku_code_snapshot,
      unit_price, quantity, line_paid_amount
    ) VALUES (
      '${ids.orderItem}', '${ids.firstOrder}', '01J0000000000000000000032C',
      '01J0000000000000000000032D', '01J0000000000000000000032E',
      'B13 commission item', 'B13 brand', 'B13 category', 'B13 SKU',
      'B13-COMMISSION-SKU', 10.00, 1, 10.00
    );
    INSERT INTO public.refund (
      id, refund_no, order_id, origin_type, provider, amount, reason,
      is_late_payment_refund, updated_at
    ) VALUES (
      '${ids.refund}', 'RFB13COMMISSION001', '${ids.firstOrder}',
      'LATE_PAYMENT', 'MOCK', 1.00, 'B13 commission refund fixture', TRUE, CURRENT_TIMESTAMP
    ), (
      '${ids.crossOrderRefund}', 'RFB13COMMISSION002', '${ids.secondOrder}',
      'LATE_PAYMENT', 'MOCK', 1.00, 'B13 cross-order refund fixture', TRUE, CURRENT_TIMESTAMP
    );
    SET session_replication_role = origin;
  `);

  try {
    runPsql(runtime, [], `
      BEGIN;
      INSERT INTO public.order_item_commission_snapshot (
        id, order_item_id, agent_id, rule_version_id, source_type,
        category_id_snapshot, category_name_snapshot, product_id_snapshot,
        sku_id_snapshot, effective_rate, commission_base, original_commission
      ) VALUES (
        '${ids.snapshot}', '${ids.orderItem}', '${ids.agent}', '${ids.rule}', 'PLATFORM',
        '01J0000000000000000000032D', 'B13 category',
        '01J0000000000000000000032C', '01J0000000000000000000032E',
        10.0000, 10.00, 1.00
      );
      COMMIT;
    `);
    expectPsqlFailure(runtime, `
      INSERT INTO public.commission_ledger (
        id, agent_id, snapshot_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.crossAgentLedger}', '${ids.otherAgent}', '${ids.snapshot}',
        'EXPECTED_CREATED', 1.00, 0.00, 0.00, 'cross agent', 'b13-cross-agent'
      );
    `, "commission ledger snapshot must belong to the same agent", "B13 cross-agent commission ledger");
    expectPsqlFailure(runtime, `
      INSERT INTO public.commission_ledger (
        id, agent_id, snapshot_id, refund_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.crossOrderLedger}', '${ids.agent}', '${ids.snapshot}', '${ids.crossOrderRefund}',
        'REFUND_DEBIT', 0.00, -1.00, 0.00, 'cross order', 'b13-cross-order'
      );
    `, "commission refund ledger must reference the snapshot order", "B13 cross-order commission ledger");
    const ledgerInsert = runPsqlAsync(runtime, `
      SET application_name = 'b13-commission-ledger-insert';
      BEGIN;
      INSERT INTO public.commission_ledger (
        id, agent_id, snapshot_id, refund_id, ledger_type,
        expected_change, available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.refundLedger}', '${ids.agent}', '${ids.snapshot}', '${ids.refund}',
        'REFUND_DEBIT', 0.00, -1.00, 0.00, 'B13 refund debit', 'b13-refund-debit'
      );
      SELECT pg_sleep(2);
      COMMIT;
    `);
    waitForSleepingApplication(replay, "b13-commission-ledger-insert");
    const refundMutation = runPsqlAsync(runtime, `
      SET statement_timeout = '6s';
      BEGIN;
      UPDATE public.refund
      SET order_id = '${ids.secondOrder}', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.refund}';
      COMMIT;
    `);
    const [ledgerResult, refundResult] = await Promise.all([ledgerInsert, refundMutation]);
    if (ledgerResult.status !== 0) {
      throw new Error(`B13 runtime commission ledger insert failed: ${ledgerResult.stderr}`);
    }
    if (refundResult.status === 0 ||
      !refundResult.stderr.includes("refund order_id is immutable after commission reversal")) {
      throw new Error(
        `B13 refund mutation did not serialize behind its commission reversal: ${refundResult.stderr}`,
      );
    }

    expectPsqlFailure(replay, `
      UPDATE public.order_item_commission_snapshot
      SET effective_rate = 11.0000 WHERE id = '${ids.snapshot}';
    `, "order-item commission snapshot is immutable", "B13 commission snapshot UPDATE");
    expectPsqlFailure(replay, `
      UPDATE public.commission_ledger
      SET reason = 'rewritten' WHERE id = '${ids.refundLedger}';
    `, "commission ledger is immutable", "B13 commission ledger UPDATE");
    expectPsqlFailure(runtime, `
      UPDATE public.order_item_commission_snapshot
      SET effective_rate = 11.0000 WHERE id = '${ids.snapshot}';
    `, "permission denied for table order_item_commission_snapshot", "B13 runtime commission snapshot UPDATE");
    expectPsqlFailure(runtime, `
      DELETE FROM public.order_item_commission_snapshot WHERE id = '${ids.snapshot}';
    `, "permission denied for table order_item_commission_snapshot", "B13 runtime commission snapshot DELETE");
    expectPsqlFailure(replay, `
      UPDATE public.order_item
      SET line_paid_amount = 11.00 WHERE id = '${ids.orderItem}';
    `, "paid order-item commission source fields are immutable", "B13 commission order-item parent UPDATE");
    expectPsqlFailure(runtime, `
      BEGIN;
      UPDATE public.sales_order
      SET final_channel = 'DIRECT', final_agent_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.firstOrder}';
      COMMIT;
    `, "order final attribution cannot contradict an immutable commission snapshot", "B13 snapshot final-agent mismatch");

    runPsql(runtime, [], `
      BEGIN;
      UPDATE public.sales_order
      SET final_channel = 'DIRECT', final_agent_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.firstOrder}';
      UPDATE public.sales_order
      SET final_channel = 'AGENT', final_agent_id = '${ids.agent}', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.firstOrder}';
      COMMIT;
    `);

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_migrator;
      DELETE FROM public.commission_ledger WHERE id = '${ids.refundLedger}';
      DELETE FROM public.order_item_commission_snapshot WHERE id = '${ids.snapshot}';
      ROLLBACK;
    `);
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.commission_ledger
      WHERE id IN ('${ids.refundLedger}', '${ids.crossAgentLedger}', '${ids.crossOrderLedger}');
      DELETE FROM public.order_item_commission_snapshot WHERE id = '${ids.snapshot}';
      DELETE FROM public.refund WHERE id IN ('${ids.refund}', '${ids.crossOrderRefund}');
      DELETE FROM public.order_item WHERE id = '${ids.orderItem}';
      DELETE FROM public.sales_order WHERE id IN ('${ids.firstOrder}', '${ids.secondOrder}');
      DELETE FROM public.commission_rule_version WHERE id = '${ids.rule}';
      DELETE FROM public.customer_profile WHERE id IN ('${ids.firstCustomer}', '${ids.secondCustomer}');
      DELETE FROM public.agent_profile WHERE id IN ('${ids.agent}', '${ids.otherAgent}');
      DELETE FROM public.account WHERE id IN (
        '${ids.account}', '${ids.otherAccount}',
        '${ids.firstCustomerAccount}', '${ids.secondCustomerAccount}'
      );
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.commission_ledger
       WHERE id IN ('${ids.refundLedger}', '${ids.crossAgentLedger}', '${ids.crossOrderLedger}')
       UNION ALL SELECT id FROM public.order_item_commission_snapshot WHERE id = '${ids.snapshot}'
       UNION ALL SELECT id FROM public.refund WHERE id IN ('${ids.refund}', '${ids.crossOrderRefund}')
       UNION ALL SELECT id FROM public.order_item WHERE id = '${ids.orderItem}'
       UNION ALL SELECT id FROM public.sales_order WHERE id IN ('${ids.firstOrder}', '${ids.secondOrder}')
       UNION ALL SELECT id FROM public.commission_rule_version WHERE id = '${ids.rule}'
       UNION ALL SELECT id FROM public.customer_profile
       WHERE id IN ('${ids.firstCustomer}', '${ids.secondCustomer}')
       UNION ALL SELECT id FROM public.agent_profile WHERE id IN ('${ids.agent}', '${ids.otherAgent}')
       UNION ALL SELECT id FROM public.account WHERE id IN (
         '${ids.account}', '${ids.otherAccount}',
         '${ids.firstCustomerAccount}', '${ids.secondCustomerAccount}'
       )
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("B13 commission guard test left fixture residue");

  console.log("B13 commission immutability, parent continuity, refund serialization and migrator cleanup verified");
}

function verifyB13PromotionLifecycle(replay) {
  const runtime = { ...replay, username: "mall_runtime", password: `${replay.password}-runtime` };
  const ids = {
    account: "01J00000000000000000000331",
    agent: "01J00000000000000000000332",
    invite: "01J00000000000000000000333",
    promotion: "01J00000000000000000000334",
    candidate: "01J00000000000000000000335",
    customerAccount: "01J00000000000000000000336",
    customer: "01J00000000000000000000337",
    unusedInvite: "01J00000000000000000000338",
    unusedPromotion: "01J00000000000000000000339",
    rewrittenInvite: "01J0000000000000000000033A",
    rewrittenPromotion: "01J0000000000000000000033B",
    rewrittenCandidate: "01J0000000000000000000033C",
  };

  runPsql(runtime, [], `
    BEGIN;
    INSERT INTO public.account (id, role, updated_at) VALUES
      ('${ids.account}', 'AGENT_ADMIN', CURRENT_TIMESTAMP),
      ('${ids.customerAccount}', 'CUSTOMER', CURRENT_TIMESTAMP);
    INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
    VALUES ('${ids.agent}', '${ids.account}', 'B13-PROMOTION', 'B13 promotion agent', CURRENT_TIMESTAMP);
    INSERT INTO public.customer_profile (id, account_id, updated_at)
    VALUES ('${ids.customer}', '${ids.customerAccount}', CURRENT_TIMESTAMP);
    INSERT INTO public.agent_invite_code (
      id, agent_id, code_hash, code_ciphertext, code_last4, encryption_key_id,
      status, effective_at, expires_at
    ) VALUES (
      '${ids.invite}', '${ids.agent}', repeat('b', 64), decode('11223344', 'hex'),
      '5678', 'b13-invite-key', 'ACTIVE', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z'
    ), (
      '${ids.unusedInvite}', '${ids.agent}', repeat('e', 64), decode('55667788', 'hex'),
      '9876', 'b13-invite-key', 'DISABLED', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z'
    );
    INSERT INTO public.promotion_asset (
      id, agent_id, invite_code_id, target_type, authorization_version,
      public_url, expires_at, created_at
    ) VALUES (
      '${ids.promotion}', '${ids.agent}', '${ids.invite}', 'STOREFRONT', 1,
      'https://store.example.invalid/b13', '2026-09-03T00:00:00Z', '2026-09-02T00:00:00Z'
    ), (
      '${ids.unusedPromotion}', '${ids.agent}', '${ids.invite}', 'STOREFRONT', 1,
      'https://store.example.invalid/b13-unused', '2026-09-03T00:00:00Z', '2026-09-02T00:00:00Z'
    );
    INSERT INTO public.attribution_candidate (
      id, candidate_token_hash, agent_id, invite_code_id, promotion_asset_id, status,
      expires_at, created_at, updated_at
    ) VALUES (
      '${ids.candidate}', repeat('a', 64), '${ids.agent}', '${ids.invite}', '${ids.promotion}', 'ACTIVE',
      '2026-09-02T00:30:00Z', '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z'
    );
    COMMIT;
  `);

  try {
    runPsql(runtime, [], `
      UPDATE public.attribution_candidate
      SET candidate_token_hash = NULL, customer_id = '${ids.customer}',
          updated_at = '2026-09-02T00:01:00Z'
      WHERE id = '${ids.candidate}';
      UPDATE public.attribution_candidate
      SET status = 'CONFIRMED', confirmed_at = '2026-09-02T00:02:00Z',
          updated_at = '2026-09-02T00:02:00Z'
      WHERE id = '${ids.candidate}';
    `);
    expectPsqlFailure(runtime, `
      UPDATE public.attribution_candidate
      SET status = 'ACTIVE', confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.candidate}';
    `, "invalid attribution candidate lifecycle transition", "B13 candidate terminal reopen");
    expectPsqlFailure(runtime, `
      UPDATE public.attribution_candidate
      SET status = 'REJECTED', confirmed_at = NULL, invalid_reason = 'rewritten terminal',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.candidate}';
    `, "invalid attribution candidate lifecycle transition", "B13 candidate terminal rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.attribution_candidate
      SET confirmed_at = '2026-09-02T00:03:00Z', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.candidate}';
    `, "terminal attribution candidate facts are immutable", "B13 candidate terminal timestamp rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.attribution_candidate
      SET candidate_token_hash = repeat('d', 64), customer_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.candidate}';
    `, "invalid attribution candidate subject transition", "B13 candidate terminal subject rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.agent_invite_code SET id = '${ids.rewrittenInvite}'
      WHERE id = '${ids.unusedInvite}';
    `, "invite code identity and encrypted value are immutable", "B13 invite primary-key rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.promotion_asset SET id = '${ids.rewrittenPromotion}'
      WHERE id = '${ids.unusedPromotion}';
    `, "promotion asset subject, target and public URL are immutable", "B13 promotion primary-key rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.attribution_candidate
      SET id = '${ids.rewrittenCandidate}', updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.candidate}';
    `, "attribution candidate agent and promotion identity are immutable", "B13 candidate primary-key rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.agent_invite_code
      SET status = 'EXPIRED', ended_at = '2026-09-02T12:00:00Z', end_reason = 'expired'
      WHERE id = '${ids.invite}';
    `, "chk_b13_invite_code_lifecycle", "B13 early invite expiry");
    expectPsqlFailure(runtime, `
      UPDATE public.promotion_asset
      SET status = 'EXPIRED', revoked_at = '2026-09-02T12:00:00Z'
      WHERE id = '${ids.promotion}';
    `, "chk_b13_promotion_asset_envelope", "B13 early promotion expiry");
    runPsql(runtime, [], `
      UPDATE public.agent_invite_code
      SET status = 'ROTATED', ended_at = '2026-09-02T00:04:00Z', end_reason = 'rotated'
      WHERE id = '${ids.invite}';
      UPDATE public.promotion_asset
      SET status = 'REVOKED', revoked_at = '2026-09-02T00:04:00Z'
      WHERE id = '${ids.promotion}';
    `);
    expectPsqlFailure(runtime, `
      UPDATE public.agent_invite_code
      SET ended_at = '2026-09-02T00:05:00Z', end_reason = 'rewritten rotation'
      WHERE id = '${ids.invite}';
    `, "terminal invite code lifecycle facts are immutable", "B13 invite terminal evidence rewrite");
    expectPsqlFailure(runtime, `
      UPDATE public.promotion_asset
      SET revoked_at = '2026-09-02T00:05:00Z'
      WHERE id = '${ids.promotion}';
    `, "terminal promotion asset lifecycle facts are immutable", "B13 promotion terminal evidence rewrite");
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.attribution_candidate
      WHERE id IN ('${ids.candidate}', '${ids.rewrittenCandidate}');
      DELETE FROM public.promotion_asset
      WHERE id IN ('${ids.promotion}', '${ids.unusedPromotion}', '${ids.rewrittenPromotion}');
      DELETE FROM public.agent_invite_code
      WHERE id IN ('${ids.invite}', '${ids.unusedInvite}', '${ids.rewrittenInvite}');
      DELETE FROM public.customer_profile WHERE id = '${ids.customer}';
      DELETE FROM public.agent_profile WHERE id = '${ids.agent}';
      DELETE FROM public.account WHERE id IN ('${ids.account}', '${ids.customerAccount}');
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.attribution_candidate
       WHERE id IN ('${ids.candidate}', '${ids.rewrittenCandidate}')
       UNION ALL SELECT id FROM public.promotion_asset
       WHERE id IN ('${ids.promotion}', '${ids.unusedPromotion}', '${ids.rewrittenPromotion}')
       UNION ALL SELECT id FROM public.agent_invite_code
       WHERE id IN ('${ids.invite}', '${ids.unusedInvite}', '${ids.rewrittenInvite}')
       UNION ALL SELECT id FROM public.customer_profile WHERE id = '${ids.customer}'
       UNION ALL SELECT id FROM public.agent_profile WHERE id = '${ids.agent}'
       UNION ALL SELECT id FROM public.account WHERE id IN ('${ids.account}', '${ids.customerAccount}')
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("B13 promotion lifecycle test left fixture residue");

  console.log("B13 invite, promotion and attribution-candidate terminal lifecycle guards verified");
}

function verifyB13WithdrawalGuards(replay) {
  const runtime = { ...replay, username: "mall_runtime", password: `${replay.password}-runtime` };
  const ids = {
    agentAccount: "01J00000000000000000000341",
    agent: "01J00000000000000000000342",
    admin: "01J00000000000000000000343",
    bank: "01J00000000000000000000344",
    proofFile: "01J00000000000000000000345",
    missingWithdrawal: "01J00000000000000000000346",
    wrongWithdrawal: "01J00000000000000000000347",
    wrongSnapshot: "01J00000000000000000000348",
    wrongLedger: "01J00000000000000000000349",
    duplicateWithdrawal: "01J0000000000000000000034A",
    duplicateSnapshot: "01J0000000000000000000034B",
    duplicateLedgerOne: "01J0000000000000000000034C",
    duplicateLedgerTwo: "01J0000000000000000000034D",
    rejectedWithdrawal: "01J0000000000000000000034E",
    rejectedSnapshot: "01J0000000000000000000034F",
    rejectedFreeze: "01J0000000000000000000034G",
    rejectedRelease: "01J0000000000000000000034H",
    paidWithdrawal: "01J0000000000000000000034J",
    paidSnapshot: "01J0000000000000000000034K",
    paidFreeze: "01J0000000000000000000034M",
    paidLedger: "01J0000000000000000000034N",
    paidProof: "01J0000000000000000000034P",
    rewrittenWithdrawal: "01J0000000000000000000034Q",
  };

  runPsql(runtime, [], `
    BEGIN;
    INSERT INTO public.account (id, role, updated_at) VALUES
      ('${ids.agentAccount}', 'AGENT_ADMIN', CURRENT_TIMESTAMP),
      ('${ids.admin}', 'SUPER_ADMIN', CURRENT_TIMESTAMP);
    INSERT INTO public.agent_profile (id, account_id, agent_no, name, updated_at)
    VALUES ('${ids.agent}', '${ids.agentAccount}', 'B13-WITHDRAWAL', 'B13 withdrawal agent', CURRENT_TIMESTAMP);
    INSERT INTO public.agent_bank_account (
      id, agent_id, account_holder, bank_name, account_no_ciphertext,
      account_no_hash, account_no_last4, encryption_key_id, updated_at
    ) VALUES (
      '${ids.bank}', '${ids.agent}', 'B13 account holder', 'B13 fixture bank',
      decode('01020304', 'hex'), repeat('d', 64), '6789', 'b13-bank-key', CURRENT_TIMESTAMP
    );
    INSERT INTO public.file_asset (
      id, object_key, original_name, mime_type, byte_size, sha256,
      visibility, status, purpose, created_by_id
    ) VALUES (
      '${ids.proofFile}', 'private/b13/withdrawal-proof.png', 'withdrawal-proof.png',
      'image/png', 1, repeat('e', 64), 'PRIVATE', 'READY', 'WITHDRAWAL_PROOF', '${ids.admin}'
    );
    COMMIT;
  `);

  try {
    expectPsqlFailure(runtime, `
      SELECT public.enforce_b13_withdrawal_consistency();
    `, "permission denied for function enforce_b13_withdrawal_consistency", "B13 direct guard execution");

    expectPsqlFailure(runtime, `
      BEGIN;
      INSERT INTO public.withdrawal (
        id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
      ) VALUES (
        '${ids.missingWithdrawal}', 'WDB13MISSING001', '${ids.agent}',
        10.00, 20.00, 10.00, CURRENT_TIMESTAMP
      );
      COMMIT;
    `, "withdrawal requires exactly one immutable bank snapshot", "B13 missing withdrawal snapshot");

    expectPsqlFailure(runtime, `
      BEGIN;
      INSERT INTO public.withdrawal (
        id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
      ) VALUES (
        '${ids.wrongWithdrawal}', 'WDB13WRONG001', '${ids.agent}',
        10.00, 20.00, 10.00, CURRENT_TIMESTAMP
      );
      INSERT INTO public.withdrawal_bank_snapshot (
        id, withdrawal_id, source_bank_account_id, account_holder, bank_name,
        account_no_ciphertext, account_no_last4, encryption_key_id
      ) VALUES (
        '${ids.wrongSnapshot}', '${ids.wrongWithdrawal}', '${ids.bank}',
        'B13 account holder', 'B13 fixture bank', decode('01020304', 'hex'),
        '6789', 'b13-bank-key'
      );
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.wrongLedger}', '${ids.agent}', '${ids.wrongWithdrawal}',
        'WITHDRAWAL_FREEZE', 0.00, -9.00, 9.00, 'wrong freeze', 'b13-wrong-freeze'
      );
      COMMIT;
    `, "withdrawal ledger amount must equal the immutable withdrawal amount", "B13 wrong withdrawal delta");

    expectPsqlFailure(runtime, `
      BEGIN;
      INSERT INTO public.withdrawal (
        id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
      ) VALUES (
        '${ids.duplicateWithdrawal}', 'WDB13DUPLICATE01', '${ids.agent}',
        10.00, 20.00, 10.00, CURRENT_TIMESTAMP
      );
      INSERT INTO public.withdrawal_bank_snapshot (
        id, withdrawal_id, source_bank_account_id, account_holder, bank_name,
        account_no_ciphertext, account_no_last4, encryption_key_id
      ) VALUES (
        '${ids.duplicateSnapshot}', '${ids.duplicateWithdrawal}', '${ids.bank}',
        'B13 account holder', 'B13 fixture bank', decode('01020304', 'hex'),
        '6789', 'b13-bank-key'
      );
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES
        ('${ids.duplicateLedgerOne}', '${ids.agent}', '${ids.duplicateWithdrawal}',
         'WITHDRAWAL_FREEZE', 0.00, -10.00, 10.00, 'first freeze', 'b13-freeze-one'),
        ('${ids.duplicateLedgerTwo}', '${ids.agent}', '${ids.duplicateWithdrawal}',
         'WITHDRAWAL_FREEZE', 0.00, -10.00, 10.00, 'second freeze', 'b13-freeze-two');
      COMMIT;
    `, "uq_commission_ledger_withdrawal_type", "B13 duplicate withdrawal freeze");

    runPsql(runtime, [], `
      BEGIN;
      INSERT INTO public.withdrawal (
        id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
      ) VALUES (
        '${ids.rejectedWithdrawal}', 'WDB13REJECTED001', '${ids.agent}',
        10.00, 20.00, 10.00, CURRENT_TIMESTAMP
      );
      INSERT INTO public.withdrawal_bank_snapshot (
        id, withdrawal_id, source_bank_account_id, account_holder, bank_name,
        account_no_ciphertext, account_no_last4, encryption_key_id
      ) VALUES (
        '${ids.rejectedSnapshot}', '${ids.rejectedWithdrawal}', '${ids.bank}',
        'B13 account holder', 'B13 fixture bank', decode('01020304', 'hex'),
        '6789', 'b13-bank-key'
      );
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.rejectedFreeze}', '${ids.agent}', '${ids.rejectedWithdrawal}',
        'WITHDRAWAL_FREEZE', 0.00, -10.00, 10.00, 'freeze', 'b13-rejected-freeze'
      );
      COMMIT;

      BEGIN;
      UPDATE public.withdrawal
      SET status = 'REJECTED', review_reason = 'Fixture rejection',
          reviewed_by_id = '${ids.admin}', reviewed_at = CURRENT_TIMESTAMP,
          version = 2, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.rejectedWithdrawal}';
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.rejectedRelease}', '${ids.agent}', '${ids.rejectedWithdrawal}',
        'WITHDRAWAL_RELEASE', 0.00, 10.00, -10.00, 'release', 'b13-rejected-release'
      );
      COMMIT;
    `);

    runPsql(runtime, [], `
      BEGIN;
      INSERT INTO public.withdrawal (
        id, withdrawal_no, agent_id, amount, available_before, frozen_after, updated_at
      ) VALUES (
        '${ids.paidWithdrawal}', 'WDB13PAID000001', '${ids.agent}',
        10.00, 20.00, 10.00, CURRENT_TIMESTAMP
      );
      INSERT INTO public.withdrawal_bank_snapshot (
        id, withdrawal_id, source_bank_account_id, account_holder, bank_name,
        account_no_ciphertext, account_no_last4, encryption_key_id
      ) VALUES (
        '${ids.paidSnapshot}', '${ids.paidWithdrawal}', '${ids.bank}',
        'B13 account holder', 'B13 fixture bank', decode('01020304', 'hex'),
        '6789', 'b13-bank-key'
      );
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.paidFreeze}', '${ids.agent}', '${ids.paidWithdrawal}',
        'WITHDRAWAL_FREEZE', 0.00, -10.00, 10.00, 'freeze', 'b13-paid-freeze'
      );
      COMMIT;
      UPDATE public.withdrawal
      SET status = 'APPROVED', reviewed_by_id = '${ids.admin}', reviewed_at = CURRENT_TIMESTAMP,
          version = 2, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.paidWithdrawal}';
    `);

    expectPsqlFailure(runtime, `
      BEGIN;
      UPDATE public.withdrawal
      SET status = 'PAID', paid_by_id = '${ids.admin}', paid_at = CURRENT_TIMESTAMP,
          version = 3, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.paidWithdrawal}';
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.paidLedger}', '${ids.agent}', '${ids.paidWithdrawal}',
        'WITHDRAWAL_PAID', 0.00, 0.00, -10.00, 'paid', 'b13-paid-ledger'
      );
      COMMIT;
    `, "PAID withdrawal requires at least one payment proof", "B13 PAID without proof");

    runPsql(runtime, [], `
      BEGIN;
      UPDATE public.withdrawal
      SET status = 'PAID', paid_by_id = '${ids.admin}', paid_at = CURRENT_TIMESTAMP,
          version = 3, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.paidWithdrawal}';
      INSERT INTO public.commission_ledger (
        id, agent_id, withdrawal_id, ledger_type, expected_change,
        available_change, frozen_change, reason, idempotency_key
      ) VALUES (
        '${ids.paidLedger}', '${ids.agent}', '${ids.paidWithdrawal}',
        'WITHDRAWAL_PAID', 0.00, 0.00, -10.00, 'paid', 'b13-paid-ledger'
      );
      INSERT INTO public.withdrawal_proof (id, withdrawal_id, file_id)
      VALUES ('${ids.paidProof}', '${ids.paidWithdrawal}', '${ids.proofFile}');
      COMMIT;
    `);

    expectPsqlFailure(runtime, `
      UPDATE public.withdrawal_bank_snapshot
      SET bank_name = 'rewritten bank' WHERE id = '${ids.paidSnapshot}';
    `, "permission denied for table withdrawal_bank_snapshot", "B13 runtime bank snapshot UPDATE");
    expectPsqlFailure(runtime, `
      DELETE FROM public.withdrawal_bank_snapshot WHERE id = '${ids.paidSnapshot}';
    `, "permission denied for table withdrawal_bank_snapshot", "B13 runtime bank snapshot DELETE");
    expectPsqlFailure(runtime, `
      UPDATE public.commission_ledger
      SET reason = 'rewritten' WHERE id = '${ids.paidLedger}';
    `, "permission denied for table commission_ledger", "B13 runtime ledger UPDATE");
    expectPsqlFailure(runtime, `
      DELETE FROM public.commission_ledger WHERE id = '${ids.paidLedger}';
    `, "permission denied for table commission_ledger", "B13 runtime ledger DELETE");
    expectPsqlFailure(replay, `
      UPDATE public.withdrawal_bank_snapshot
      SET bank_name = 'rewritten bank' WHERE id = '${ids.paidSnapshot}';
    `, "withdrawal bank snapshot is immutable", "B13 bank snapshot guard UPDATE");
    expectPsqlFailure(runtime, `
      UPDATE public.withdrawal SET id = '${ids.rewrittenWithdrawal}'
      WHERE id = '${ids.paidWithdrawal}';
    `, "withdrawal identity, amount and frozen balance snapshot are immutable", "B13 withdrawal primary-key rewrite");

    runPsql(runtime, [], `
      UPDATE public.agent_bank_account
      SET bank_name = 'B13 replacement bank', account_no_ciphertext = decode('05060708', 'hex'),
          account_no_hash = repeat('f', 64), account_no_last4 = '4321',
          encryption_key_id = 'b13-bank-key-v2', version = 2, updated_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.bank}';
    `);
    const bankSnapshotPreflight = B13_PREDEPLOY_CHECKS.find(
      (check) => check.key === "withdrawal-bank-snapshot",
    );
    if (!bankSnapshotPreflight) throw new Error("B13 bank-snapshot preflight is not registered");
    const historicalSnapshotMismatch = runPsql(
      replay,
      ["-Atqc", bankSnapshotPreflight.sql],
      undefined,
      true,
    );
    if (historicalSnapshotMismatch === "0") {
      throw new Error("B13 historical preflight did not observe a legitimate post-deploy bank rotation");
    }
    if (requiresB13HistoricalPreflight(B13_DEPLOYED_HISTORY)) {
      throw new Error("B13 exact-history no-op path would rerun historical bank-snapshot predicates");
    }

    const finalState = runPsql(replay, [
      "-Atqc",
      `SELECT concat_ws('|',
         (SELECT status FROM public.withdrawal WHERE id = '${ids.rejectedWithdrawal}'),
         (SELECT count(*) FROM public.commission_ledger
          WHERE withdrawal_id = '${ids.rejectedWithdrawal}' AND ledger_type = 'WITHDRAWAL_RELEASE'),
         (SELECT status FROM public.withdrawal WHERE id = '${ids.paidWithdrawal}'),
         (SELECT count(*) FROM public.commission_ledger
          WHERE withdrawal_id = '${ids.paidWithdrawal}' AND ledger_type = 'WITHDRAWAL_PAID'
            AND available_change = 0 AND frozen_change = -10.00),
         (SELECT count(*) FROM public.withdrawal_proof WHERE withdrawal_id = '${ids.paidWithdrawal}'))`,
    ], undefined, true);
    if (finalState !== "REJECTED|1|PAID|1|1") {
      throw new Error(`B13 withdrawal facts did not converge exactly: ${finalState}`);
    }

    runPsql(replay, [], `
      BEGIN;
      SET LOCAL ROLE mall_migrator;
      DELETE FROM public.withdrawal_proof WHERE id = '${ids.paidProof}';
      DELETE FROM public.commission_ledger
      WHERE withdrawal_id IN ('${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}');
      DELETE FROM public.withdrawal_bank_snapshot
      WHERE withdrawal_id IN ('${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}');
      DELETE FROM public.withdrawal
      WHERE id IN ('${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}');
      DELETE FROM public.file_asset WHERE id = '${ids.proofFile}';
      DELETE FROM public.agent_bank_account WHERE id = '${ids.bank}';
      DELETE FROM public.agent_profile WHERE id = '${ids.agent}';
      DELETE FROM public.account WHERE id IN ('${ids.agentAccount}', '${ids.admin}');
      COMMIT;
    `);
  } finally {
    runPsql(replay, [], `
      SET session_replication_role = replica;
      DELETE FROM public.withdrawal_proof WHERE id = '${ids.paidProof}';
      DELETE FROM public.commission_ledger WHERE withdrawal_id IN (
        '${ids.wrongWithdrawal}', '${ids.duplicateWithdrawal}',
        '${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}'
      );
      DELETE FROM public.withdrawal_bank_snapshot WHERE withdrawal_id IN (
        '${ids.wrongWithdrawal}', '${ids.duplicateWithdrawal}',
        '${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}'
      );
      DELETE FROM public.withdrawal WHERE id IN (
        '${ids.missingWithdrawal}', '${ids.wrongWithdrawal}', '${ids.duplicateWithdrawal}',
        '${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}', '${ids.rewrittenWithdrawal}'
      );
      DELETE FROM public.file_asset WHERE id = '${ids.proofFile}';
      DELETE FROM public.agent_bank_account WHERE id = '${ids.bank}';
      DELETE FROM public.agent_profile WHERE id = '${ids.agent}';
      DELETE FROM public.account WHERE id IN ('${ids.agentAccount}', '${ids.admin}');
      SET session_replication_role = origin;
    `);
  }

  const residue = runPsql(replay, [
    "-Atqc",
    `SELECT count(*) FROM (
       SELECT id FROM public.withdrawal WHERE id IN (
         '${ids.missingWithdrawal}', '${ids.wrongWithdrawal}', '${ids.duplicateWithdrawal}',
         '${ids.rejectedWithdrawal}', '${ids.paidWithdrawal}', '${ids.rewrittenWithdrawal}'
       )
       UNION ALL SELECT id FROM public.withdrawal_bank_snapshot WHERE id IN (
         '${ids.wrongSnapshot}', '${ids.duplicateSnapshot}',
         '${ids.rejectedSnapshot}', '${ids.paidSnapshot}'
       )
       UNION ALL SELECT id FROM public.commission_ledger WHERE id IN (
         '${ids.wrongLedger}', '${ids.duplicateLedgerOne}', '${ids.duplicateLedgerTwo}',
         '${ids.rejectedFreeze}', '${ids.rejectedRelease}', '${ids.paidFreeze}', '${ids.paidLedger}'
       )
       UNION ALL SELECT id FROM public.withdrawal_proof WHERE id = '${ids.paidProof}'
       UNION ALL SELECT id FROM public.agent_bank_account WHERE id = '${ids.bank}'
       UNION ALL SELECT id FROM public.agent_profile WHERE id = '${ids.agent}'
       UNION ALL SELECT id FROM public.file_asset WHERE id = '${ids.proofFile}'
       UNION ALL SELECT id FROM public.account WHERE id IN ('${ids.agentAccount}', '${ids.admin}')
     ) AS fixture_residue`,
  ], undefined, true);
  if (residue !== "0") throw new Error("B13 withdrawal guard test left fixture residue");
  console.log("B13 withdrawal freeze, reject, paid-proof, exact-delta, permissions and cleanup verified");
}

function verifyB13ChecksumTamperGate(replay) {
  const expectedChecksum = "355311f6a5091f03bcb879f927ca78c984ec2cb26efb7f14bb4133161ccc2ea0";
  const readHistory = () => runPsql(
    replay,
    ["-Atqc", B13_MIGRATION_HISTORY_SQL],
    undefined,
    true,
  );
  const readSchemaState = () => runPsql(replay, [
    "-Atqc",
    `SELECT concat_ws('|',
       (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'chk_b13_%'),
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_b13_%'),
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'enforce_b13_%' OR p.proname LIKE 'guard_b13_%')),
       (SELECT count(*) FROM pg_class WHERE relname = 'uq_commission_ledger_withdrawal_type'))`,
  ], undefined, true);
  const historyBefore = readHistory();
  if (!isApprovedB13Predecessor(historyBefore) || !isExactB13History(historyBefore)) {
    throw new Error(
      `B13 checksum test did not start from exact deployed history: ${historyBefore || "empty"}`,
    );
  }
  const before = readSchemaState();

  runPsql(replay, [], `
    UPDATE public._prisma_migrations
    SET checksum = repeat('0', 64)
    WHERE migration_name = '0006_b13_agent_finance_guards';
  `);
  try {
    const tamperedHistory = readHistory();
    if (isApprovedB13Predecessor(tamperedHistory) || isExactB13History(tamperedHistory)) {
      throw new Error("B13 deployment gate accepted a tampered 0006 migration checksum");
    }
    if (readSchemaState() !== before) {
      throw new Error("B13 checksum rejection changed the deployed schema");
    }
  } finally {
    runPsql(replay, [], `
      UPDATE public._prisma_migrations
      SET checksum = '${expectedChecksum}'
      WHERE migration_name = '0006_b13_agent_finance_guards';
    `);
  }
  const restoredHistory = readHistory();
  if (restoredHistory !== B13_DEPLOYED_HISTORY) {
    throw new Error(`B13 checksum test did not restore exact history: ${restoredHistory || "empty"}`);
  }
  console.log("B13 exact-history deployment gate rejected a tampered checksum without schema residue");
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
  verifyB12MigrationFailurePaths(replay, migratorConnection);

  for (const migrationName of [
    "0002_b9_inventory_fact_indexes",
    "0003_b10_payment_fact_indexes",
    "0004_b10_commission_position_trigger_fix",
    "0005_b12_aftersale_refund_guards",
  ]) {
    runPsql(migratorConnection, ["-f", `prisma/migrations/${migrationName}/migration.sql`]);
    resolveAppliedMigration(migratorConnection, migratorUrl.toString(), migrationName);
  }
  const b12History = runPsql(
    replay,
    ["-Atqc", B13_MIGRATION_HISTORY_SQL],
    undefined,
    true,
  );
  if (!requiresB13HistoricalPreflight(b12History)) {
    throw new Error(`CI replay did not reach the exact B12 predecessor: ${b12History}`);
  }
  verifyB13MigrationFailurePaths(replay, migratorConnection);

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
  verifyB13ChecksumTamperGate(replay);
  verifyB9IndexPlans(migratorConnection);
  verifyB10IndexPlans(migratorConnection);
  verifyB10CommissionPositionRuntime(replay);
  await verifyB12RefundGuards(replay);
  await verifyB13AgentRoleRace(replay);
  await verifyB13CommissionGuards(replay);
  verifyB13PromotionLifecycle(replay);
  verifyB13WithdrawalGuards(replay);
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
