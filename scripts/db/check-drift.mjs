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
           AND checksum = 'f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0002_b9_inventory_fact_indexes'
           AND checksum = '9c933d256e0cbe7c33acdd801b6385bae6f892ff3db10978c40e37ea2f89f5d0'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0003_b10_payment_fact_indexes'
           AND checksum = '0d5109a6d0eab2598f2c6c98bbeca265bdd32733e7d89f8eb78eff67caedb836'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0004_b10_commission_position_trigger_fix'
           AND checksum = '8d4c391af114c4691d2be80ae8bb44efc1c70658f5268ad4de7221a29d5ee102'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0005_b12_aftersale_refund_guards'
           AND checksum = '95f362667bdc6a0b751ae636d91a139a71a3f40155ba764937db01d5bbce412b'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ),
       count(*) FILTER (
         WHERE migration_name = '0006_b13_agent_finance_guards'
           AND checksum = '355311f6a5091f03bcb879f927ca78c984ec2cb26efb7f14bb4133161ccc2ea0'
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
           '0005_b12_aftersale_refund_guards',
           '0006_b13_agent_finance_guards'
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
  if (history.stdout.trim() !== "6|1|1|1|1|1|1|0|0") {
    throw new Error("Supabase development database is not on the exact completed B13 migration chain");
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
