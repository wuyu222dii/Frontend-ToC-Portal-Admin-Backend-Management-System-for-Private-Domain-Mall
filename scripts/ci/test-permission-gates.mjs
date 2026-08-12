import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "../db/lib/connection.mjs";

const verifyArgs = ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-f", "scripts/db/sql/verify.sql"];

function run(connection, args, { expectSuccess = true } = {}) {
  const result = spawnSync("psql", args, {
    env: postgresEnvironment(connection),
    encoding: "utf8",
    stdio: expectSuccess ? "inherit" : "ignore",
  });
  if (result.error) throw result.error;
  if (expectSuccess && result.status !== 0) throw new Error("database permission command failed");
  return result.status === 0;
}

function execute(connection, sql) {
  run(connection, ["-X", "-v", "ON_ERROR_STOP=1", "-qc", sql]);
}

function query(connection, sql) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-Atqc", sql], {
    env: postgresEnvironment(connection),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("database permission query failed");
  return result.stdout.trim();
}

try {
  const connection = readConnection("REPLAY_DATABASE_URL", "ci-replay");
  const faults = [
    {
      label: "PUBLIC application table SELECT",
      grant: "GRANT SELECT ON public.sales_order TO PUBLIC",
      revoke: "REVOKE SELECT ON public.sales_order FROM PUBLIC",
    },
    {
      label: "runtime immutable ledger UPDATE",
      grant: "GRANT UPDATE ON public.commission_ledger TO mall_runtime",
      revoke: "REVOKE UPDATE ON public.commission_ledger FROM mall_runtime",
    },
    {
      label: "runtime transaction-table TRUNCATE",
      grant: "GRANT TRUNCATE ON public.sales_order TO mall_runtime",
      revoke: "REVOKE TRUNCATE ON public.sales_order FROM mall_runtime",
    },
    {
      label: "runtime transaction-table TRIGGER",
      grant: "GRANT TRIGGER ON public.sales_order TO mall_runtime",
      revoke: "REVOKE TRIGGER ON public.sales_order FROM mall_runtime",
    },
    {
      label: "runtime transaction-table REFERENCES",
      grant: "GRANT REFERENCES ON public.sales_order TO mall_runtime",
      revoke: "REVOKE REFERENCES ON public.sales_order FROM mall_runtime",
    },
    {
      label: "runtime forbidden inspection column UPDATE",
      grant: "GRANT UPDATE (status) ON public.return_inspection TO mall_runtime",
      revoke: "REVOKE UPDATE (status) ON public.return_inspection FROM mall_runtime",
    },
    {
      label: "anon column-level UPDATE",
      grant: "GRANT UPDATE (status) ON public.return_inspection TO anon",
      revoke: "REVOKE UPDATE (status) ON public.return_inspection FROM anon",
    },
    {
      label: "authenticator table SELECT",
      grant: "GRANT SELECT ON public.sales_order TO authenticator",
      revoke: "REVOKE SELECT ON public.sales_order FROM authenticator",
    },
    {
      label: "authenticator column-level UPDATE",
      grant: "GRANT UPDATE (status) ON public.return_inspection TO authenticator",
      revoke: "REVOKE UPDATE (status) ON public.return_inspection FROM authenticator",
    },
    {
      label: "service_role application function EXECUTE",
      grant: "GRANT EXECUTE ON FUNCTION public.is_valid_ulid(text) TO service_role",
      revoke: "REVOKE EXECUTE ON FUNCTION public.is_valid_ulid(text) FROM service_role",
    },
    {
      label: "authenticator SET ROLE mall_runtime",
      grant: "GRANT mall_runtime TO authenticator WITH INHERIT FALSE, SET TRUE",
      revoke: "REVOKE mall_runtime FROM authenticator",
    },
    {
      label: "runtime RLS policy exposed to PUBLIC",
      grant: "ALTER POLICY mall_runtime_access ON public.account TO PUBLIC",
      revoke: "ALTER POLICY mall_runtime_access ON public.account TO mall_runtime",
    },
  ];

  run(connection, verifyArgs);
  for (const fault of faults) {
    execute(connection, fault.grant);
    try {
      if (run(connection, verifyArgs, { expectSuccess: false })) {
        throw new Error(`permission verifier accepted ${fault.label}`);
      }
      console.log(`permission fault rejected: ${fault.label}`);
    } finally {
      execute(connection, fault.revoke);
    }
    run(connection, verifyArgs);
  }
  execute(
    connection,
    "CREATE SEQUENCE public.permission_gate_test; GRANT UPDATE ON SEQUENCE public.permission_gate_test TO mall_runtime",
  );
  try {
    if (run(connection, verifyArgs, { expectSuccess: false })) {
      throw new Error("permission verifier accepted runtime sequence UPDATE");
    }
    console.log("permission fault rejected: runtime sequence UPDATE");
  } finally {
    execute(connection, "DROP SEQUENCE public.permission_gate_test");
  }
  run(connection, verifyArgs);
  const originalFunction = query(
    connection,
    "SELECT pg_get_functiondef('public.is_valid_ulid(text)'::regprocedure)",
  );
  execute(
    connection,
    "CREATE OR REPLACE FUNCTION public.is_valid_ulid(value text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS 'SELECT TRUE'",
  );
  try {
    if (run(connection, verifyArgs, { expectSuccess: false })) {
      throw new Error("permission verifier accepted application function body drift");
    }
    console.log("permission fault rejected: application function body drift");
  } finally {
    execute(connection, originalFunction);
  }
  run(connection, verifyArgs);
  console.log("permission verifier fault-injection suite passed");
} catch (error) {
  console.error(`permission verifier test failed: ${error.message}`);
  process.exit(1);
}
