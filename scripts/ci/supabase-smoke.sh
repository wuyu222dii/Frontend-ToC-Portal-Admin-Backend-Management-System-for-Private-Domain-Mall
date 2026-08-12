#!/usr/bin/env bash
set -Eeuo pipefail

: "${DIRECT_URL:?DIRECT_URL must be the approved Supabase development direct connection}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF must identify the approved development project}"

if [[ ! "${SUPABASE_PROJECT_REF}" =~ ^[a-z]{20}$ ]]; then
  printf 'Refusing smoke test: SUPABASE_PROJECT_REF must be a 20-letter project reference.\n' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

node "${repo_root}/scripts/db/validate-connection.mjs" DIRECT_URL migrator

# Keep the protected smoke test aligned with the complete local permission gate:
# table DML allowlists, function execution, role membership, RLS and ownership.
node "${repo_root}/scripts/db/lib/run-psql.mjs" DIRECT_URL migrator -- \
  -f "scripts/db/sql/verify.sql"

node "${repo_root}/scripts/db/lib/run-psql.mjs" DIRECT_URL migrator -- <<'SQL'
SELECT current_database(), current_user, version();

DO $smoke$
DECLARE
  table_count INTEGER;
  policy_count INTEGER;
BEGIN
  SELECT count(*) INTO table_count
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> '_prisma_migrations';

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'mall_runtime_access';

  IF table_count <> 76 OR policy_count <> 76 THEN
    RAISE EXCEPTION 'Supabase baseline mismatch: tables %, policies %', table_count, policy_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['authenticator', 'anon', 'authenticated', 'service_role']) AS denied(role_name)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege(denied.role_name, c.oid, 'SELECT')
        OR has_table_privilege(denied.role_name, c.oid, 'INSERT')
        OR has_table_privilege(denied.role_name, c.oid, 'UPDATE')
        OR has_table_privilege(denied.role_name, c.oid, 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'Supabase Data API role has an application table grant';
  END IF;
END
$smoke$;
SQL

DIRECT_URL="${DIRECT_URL}" PRISMA_CONFIG="${PRISMA_CONFIG:-${repo_root}/prisma.config.ts}" \
  "${repo_root}/scripts/ci/verify-migration-diff.sh"

printf 'Supabase development smoke test passed.\n'
