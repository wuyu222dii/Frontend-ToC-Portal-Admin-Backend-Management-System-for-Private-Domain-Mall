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

  runPsql(replay, ["-f", "scripts/db/sql/post-bootstrap.sql"]);
  runPsql(replay, ["-At", "-f", "scripts/db/sql/verify.sql"]);
  console.log("CI ephemeral PostgreSQL migration replay passed");
} catch (error) {
  console.error(`CI migration replay failed: ${error.message}`);
  process.exit(1);
}
