#!/usr/bin/env bash
set -Eeuo pipefail

: "${DIRECT_URL:?DIRECT_URL must point to the database that received the baseline migration}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
prisma_config="${PRISMA_CONFIG:-${repo_root}/prisma.config.ts}"
schema_file="${PRISMA_SCHEMA:-${repo_root}/prisma/schema.prisma}"

if [[ ! -f "${prisma_config}" ]]; then
  printf 'Prisma config not found: %s\n' "${prisma_config}" >&2
  exit 1
fi

if [[ ! -f "${schema_file}" ]]; then
  printf 'Prisma schema not found: %s\n' "${schema_file}" >&2
  exit 1
fi

# Prisma only compares features represented in its data model. PostgreSQL-only
# CHECKs, partial indexes, triggers, roles and RLS are verified by replay-baseline.
pnpm exec prisma migrate diff \
  --config "${prisma_config}" \
  --exit-code \
  --from-config-datasource \
  --to-schema "${schema_file}"

printf 'Prisma-supported database objects match %s.\n' "${schema_file}"
