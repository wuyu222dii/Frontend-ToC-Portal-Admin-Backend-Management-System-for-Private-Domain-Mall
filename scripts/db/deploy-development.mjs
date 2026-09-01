import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

const APPROVAL = "DEVELOPMENT_MIGRATION_APPROVED";
const EXPECTED_BEFORE = new Set([
  "4|1|1|1|1|0|0|0",
  "5|1|1|1|1|1|0|0",
]);
const EXPECTED_AFTER = "5|1|1|1|1|1|0|0";

function runPsql(connection, args, capture = false) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: postgresEnvironment(connection),
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error("psql command failed");
  }
  return capture ? result.stdout.trim() : undefined;
}

function runPrisma(connection, args, label) {
  const prisma = prismaInvocation(args);
  const result = spawnSync(prisma.command, prisma.args, {
    env: prismaEnvironment(process.env.DIRECT_URL, postgresEnvironment(connection)),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label);
}

function readHistory(connection) {
  return runPsql(connection, [
    "-Atqc",
    `SELECT concat_ws('|',
       count(*),
       count(*) FILTER (
         WHERE migration_name = '0001_initial'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0002_b9_inventory_fact_indexes'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0003_b10_payment_fact_indexes'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0004_b10_commission_position_trigger_fix'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0005_b12_aftersale_refund_guards'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL),
       count(*) FILTER (
         WHERE migration_name NOT IN (
           '0001_initial',
           '0002_b9_inventory_fact_indexes',
           '0003_b10_payment_fact_indexes',
           '0004_b10_commission_position_trigger_fix',
           '0005_b12_aftersale_refund_guards'
         )
       )
     )
     FROM public._prisma_migrations`,
  ], true);
}

try {
  if (process.env.SUPABASE_MIGRATION_CONFIRM !== APPROVAL) {
    throw new Error(`SUPABASE_MIGRATION_CONFIRM must equal ${APPROVAL}`);
  }

  const migrator = readConnection("DIRECT_URL", "migrator");
  const before = readHistory(migrator);
  if (!EXPECTED_BEFORE.has(before)) {
    throw new Error(`migration history is not an approved B12 predecessor state: ${before || "empty"}`);
  }

  const duplicatePaymentFacts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT 1
       FROM public.payment_attempt
       WHERE status IN ('SUCCEEDED', 'SUCCEEDED_LATE')
       GROUP BY payment_intent_id
       HAVING count(*) > 1
     ) AS duplicate_payment_facts`,
  ], true);
  if (duplicatePaymentFacts !== "0") {
    throw new Error(`payment attempts have ${duplicatePaymentFacts} duplicate successful fact group(s)`);
  }

  const duplicateLateRefundFacts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT 1
       FROM public.refund
       WHERE origin_type = 'LATE_PAYMENT'
       GROUP BY order_id
       HAVING count(*) > 1
     ) AS duplicate_late_refund_facts`,
  ], true);
  if (duplicateLateRefundFacts !== "0") {
    throw new Error(`refunds have ${duplicateLateRefundFacts} duplicate late-payment fact group(s)`);
  }

  const duplicateActiveRefundAttempts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT 1
       FROM public.refund_attempt
       WHERE status IN ('INITIATED', 'PROCESSING')
       GROUP BY refund_id
       HAVING count(*) > 1
     ) AS duplicate_active_refund_attempts`,
  ], true);
  if (duplicateActiveRefundAttempts !== "0") {
    throw new Error(
      `refund attempts have ${duplicateActiveRefundAttempts} duplicate active fact group(s)`,
    );
  }

  const duplicateSuccessfulRefundAttempts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT 1
       FROM public.refund_attempt
       WHERE status = 'SUCCEEDED'
       GROUP BY refund_id
       HAVING count(*) > 1
     ) AS duplicate_successful_refund_attempts`,
  ], true);
  if (duplicateSuccessfulRefundAttempts !== "0") {
    throw new Error(
      `refund attempts have ${duplicateSuccessfulRefundAttempts} duplicate successful fact group(s)`,
    );
  }

  const invalidRefundEnvelopes = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM public.refund r
     JOIN public.sales_order o ON o.id = r.order_id
     LEFT JOIN public.aftersale a ON a.id = r.aftersale_id
     LEFT JOIN public.manual_compensation mc ON mc.id = r.manual_compensation_id
     LEFT JOIN public.order_item mcoi ON mcoi.id = mc.order_item_id
     WHERE
       (r.origin_type = 'AFTERSALE' AND (
         a.id IS NULL OR a.order_id <> r.order_id OR a.customer_id <> o.customer_id
       ))
       OR
       (r.origin_type = 'MANUAL_COMPENSATION' AND (
         mc.id IS NULL OR mc.order_id <> r.order_id OR mc.customer_id <> o.customer_id
         OR mcoi.id IS NULL OR mcoi.order_id <> r.order_id
       ))`,
  ], true);
  if (invalidRefundEnvelopes !== "0") {
    throw new Error(`refunds have ${invalidRefundEnvelopes} invalid source envelope(s)`);
  }

  const invalidRefundItemEnvelopes = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM public.refund_item ri
     JOIN public.refund r ON r.id = ri.refund_id
     LEFT JOIN public.order_item oi ON oi.id = ri.order_item_id
     LEFT JOIN public.aftersale_item ai ON ai.id = ri.aftersale_item_id
     LEFT JOIN public.manual_compensation mc ON mc.id = r.manual_compensation_id
     WHERE oi.id IS NULL
       OR oi.order_id <> r.order_id
       OR (r.origin_type = 'AFTERSALE' AND (
         ai.id IS NULL OR ai.aftersale_id <> r.aftersale_id
         OR ai.order_item_id <> ri.order_item_id
       ))
       OR (r.origin_type <> 'AFTERSALE' AND ri.aftersale_item_id IS NOT NULL)
       OR (r.origin_type = 'MANUAL_COMPENSATION' AND (
         mc.id IS NULL OR ri.order_item_id <> mc.order_item_id OR ri.quantity <> 1
       ))`,
  ], true);
  if (invalidRefundItemEnvelopes !== "0") {
    throw new Error(`refund items have ${invalidRefundItemEnvelopes} invalid source envelope(s)`);
  }

  const invalidRefundAmounts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT r.id
       FROM public.refund r
       LEFT JOIN public.refund_item ri ON ri.refund_id = r.id
       GROUP BY r.id, r.amount
       HAVING r.amount IS DISTINCT FROM COALESCE(sum(ri.amount), 0.00)
     ) AS invalid_refund_amounts`,
  ], true);
  if (invalidRefundAmounts !== "0") {
    throw new Error(`refunds have ${invalidRefundAmounts} head-to-item amount mismatch(es)`);
  }

  runPrisma(
    migrator,
    ["migrate", "deploy", "--config", "prisma.config.ts"],
    "B12 database migration deployment failed",
  );

  const after = readHistory(migrator);
  if (after !== EXPECTED_AFTER) {
    throw new Error(`migration history did not converge to the B12 target: ${after || "empty"}`);
  }

  runPsql(migrator, ["-At", "-f", "scripts/db/sql/verify.sql"]);
  runPrisma(
    migrator,
    [
      "migrate",
      "diff",
      "--from-schema",
      "prisma/schema.prisma",
      "--to-config-datasource",
      "--exit-code",
      "--config",
      "prisma.config.ts",
    ],
    "B12 post-migration Prisma drift check failed",
  );

  console.log("Supabase development migration and post-verification passed");
} catch (error) {
  console.error(`Supabase development migration stopped: ${error.message}`);
  process.exit(1);
}
