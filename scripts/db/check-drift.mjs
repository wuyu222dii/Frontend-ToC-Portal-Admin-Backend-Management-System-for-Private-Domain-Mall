import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

try {
  const connection = readConnection("DIRECT_URL", "migrator");
  const history = spawnSync("psql", [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
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
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL),
       count(*) FILTER (
         WHERE migration_name NOT IN (
           '0001_initial',
           '0002_b9_inventory_fact_indexes',
           '0003_b10_payment_fact_indexes',
           '0004_b10_commission_position_trigger_fix'
         )
       )
     )
     FROM public._prisma_migrations`,
  ], {
    env: postgresEnvironment(connection),
    encoding: "utf8",
  });
  if (history.error) throw history.error;
  if (history.status !== 0) throw new Error("Prisma migration history query failed");
  if (history.stdout.trim() !== "4|1|1|1|1|0|0") {
    throw new Error("Supabase development database is not on the exact completed CH-023 migration chain");
  }

  const prisma = prismaInvocation([
    "migrate",
    "diff",
    "--from-schema",
    "prisma/schema.prisma",
    "--to-config-datasource",
    "--exit-code",
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
  if (result.status === 2) throw new Error("Prisma datamodel drift detected");
  if (result.status !== 0) throw new Error("Prisma drift command failed");
  console.log("Prisma datamodel and Supabase development database are in sync");
} catch (error) {
  console.error(`database drift check failed: ${error.message}`);
  process.exit(1);
}
