import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./lib/connection.mjs";

function run(connection, args, options = {}) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: postgresEnvironment(connection),
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error("database verification command failed");
  }
  return result.stdout?.trim();
}

try {
  const migrator = readConnection("DIRECT_URL", "migrator");
  const runtime = readConnection("DATABASE_URL", "runtime");

  const structure = run(migrator, ["-At", "-f", "scripts/db/sql/verify.sql"]);
  if (structure) console.log(structure);

  const runtimeFacts = run(runtime, [
    "-Atqc",
    "SELECT current_user, current_setting('ssl') = 'on', count(*) FROM public.account",
  ]).split("|");
  if (runtimeFacts[0] !== "mall_runtime" || runtimeFacts[1] !== "t") {
    throw new Error("runtime connection did not authenticate as mall_runtime over TLS");
  }

  const runtimeFunction = run(runtime, [
    "-Atqc",
    "SELECT public.is_valid_ulid('01ARZ3NDEKTSV4RRFFQ69G5FAV')",
  ]);
  if (runtimeFunction !== "t") {
    throw new Error("mall_runtime cannot execute required application functions");
  }

  const forbidden = spawnSync("psql", [
    "-X", "-v", "ON_ERROR_STOP=1", "-Atqc", "SELECT count(*) FROM public._prisma_migrations",
  ], {
    env: postgresEnvironment(runtime),
    encoding: "utf8",
  });
  if (forbidden.status === 0) {
    throw new Error("mall_runtime unexpectedly read Prisma migration history");
  }

  console.log(JSON.stringify({
    runtimeRole: runtimeFacts[0],
    runtimeTls: true,
    runtimeTableAccess: true,
    runtimeFunctionExecute: true,
    migrationHistoryDenied: true,
  }));
} catch (error) {
  console.error(`database verification failed: ${error.message}`);
  process.exit(1);
}
