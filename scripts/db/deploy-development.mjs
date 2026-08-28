import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

const APPROVAL = "DEVELOPMENT_MIGRATION_APPROVED";
const EXPECTED_BEFORE = new Set(["1|1|0|0|0", "2|1|1|0|0"]);
const EXPECTED_AFTER = "2|1|1|0|0";

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
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL),
       count(*) FILTER (
         WHERE migration_name NOT IN ('0001_initial', '0002_b9_inventory_fact_indexes')
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
    throw new Error(`migration history is not an approved B9 predecessor state: ${before || "empty"}`);
  }
  if (before === "1|1|0|0|0") {
    runPsql(migrator, ["-At", "-f", "scripts/db/sql/verify-baseline.sql"]);
  }

  const duplicateFacts = runPsql(migrator, [
    "-Atqc",
    `SELECT count(*)
     FROM (
       SELECT 1
       FROM public.inventory_ledger
       WHERE business_id IS NOT NULL
       GROUP BY business_id, sku_id, ledger_type
       HAVING count(*) > 1
     ) AS duplicate_business_facts`,
  ], true);
  if (duplicateFacts !== "0") {
    throw new Error(`inventory ledger has ${duplicateFacts} duplicate business fact group(s)`);
  }

  runPrisma(
    migrator,
    ["migrate", "deploy", "--config", "prisma.config.ts"],
    "B9 database migration deployment failed",
  );

  const after = readHistory(migrator);
  if (after !== EXPECTED_AFTER) {
    throw new Error(`migration history did not converge to the B9 target: ${after || "empty"}`);
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
    "B9 post-migration Prisma drift check failed",
  );

  console.log("Supabase development migration and post-verification passed");
} catch (error) {
  console.error(`Supabase development migration stopped: ${error.message}`);
  process.exit(1);
}
