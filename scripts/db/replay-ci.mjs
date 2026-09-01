import { spawn, spawnSync } from "node:child_process";
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
  throw new Error("B12 concurrent refund guard fixture did not reach its synchronization point");
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
  await verifyB12RefundGuards(replay);
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
