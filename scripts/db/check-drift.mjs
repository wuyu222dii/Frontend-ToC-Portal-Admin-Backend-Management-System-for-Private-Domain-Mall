import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";
import { prismaEnvironment, prismaInvocation } from "./lib/prisma.mjs";

try {
  const connection = readConnection("DIRECT_URL", "migrator");
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
