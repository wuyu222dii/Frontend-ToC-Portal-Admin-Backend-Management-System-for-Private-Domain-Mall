# Database bootstrap and controlled migrations

Remote PostgreSQL is TencentDB in the same VPC as the API. Daily
`NODE_ENV=development` may use loopback PostgreSQL without TLS. Staging and
production must use TencentDB. Empty-schema replay still uses the disposable
`postgres-ci` overlay. Any `SUPABASE_*` variable is rejected.

## TencentDB

Set `DATABASE_PROVIDER=tencentdb`. Use the TencentDB inner hostname
(`*.sql.tencentcdb.com` or `*.postgres.tencentcdb.com`), not a private IP, so
`sslmode=verify-full` can match the server certificate.

- `DATABASE_OWNER_URL`: instance-admin URL for the first bootstrap only.
- `DIRECT_URL`: `mall_migrator` URL used by Prisma Migrate.
- `DATABASE_URL`: `mall_runtime` URL used by API/Worker.
- All three must include `sslmode=verify-full` and an explicit CA path.
- `MALL_MIGRATOR_PASSWORD` and `MALL_RUNTIME_PASSWORD` must be independent.

```sh
DATABASE_PROVIDER=tencentdb \
DATABASE_BOOTSTRAP_CONFIRM=BOOTSTRAP_EMPTY_DEV_DATABASE \
  pnpm db:bootstrap
node scripts/db/verify.mjs
node scripts/db/check-drift.mjs
```

The bootstrap applies the frozen `0001_initial` SQL as instance owner, sets role
passwords over PostgreSQL stdin, and then runs `prisma migrate resolve` through
`mall_migrator`. It immediately deploys the remaining checked-in migrations
through `mall_migrator`. Prisma creates and records `_prisma_migrations` itself;
the script never inserts or fabricates a migration-history row. The resulting
seven-row migration history is owned by `mall_migrator` and inaccessible to
`mall_runtime`. The operation can be retried after interruption only in an empty
or fully registered B15 state. A baseline-only or otherwise partial state is
refused for manual inspection; the script never resets or overwrites it.

Remove `DATABASE_OWNER_URL` from the runtime environment after verification.

After the first `SUPER_ADMIN` exists and the legal retention period has external
approval, provision the initial published business rules once:

```sh
BUSINESS_RULE_BOOTSTRAP_ADMIN_ID='<active-super-admin-ulid>' \
BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS='<approved-integer-1-to-100>' \
  pnpm admin:bootstrap-business-rules
```

The command fixes the approved development defaults at a 100 yuan minimum
withdrawal, a 7-day aftersale window, and a 30-minute payment timeout. Keep these
one-shot values out of `.env`.

## Disposable local CI database

CI replay requires `CI=true`, `ALLOW_CI_EPHEMERAL_POSTGRES=1`, and an empty
local disposable connection in `REPLAY_DATABASE_URL` (or CI `DIRECT_URL`):

```sh
node scripts/db/replay-ci.mjs
```

For a local disposable database, copy `.env.local-ci.example` to `.env.local-ci`.
Daily development can point `.env` at the same `127.0.0.1:5433` URLs. Start only
the profiled service:

```sh
docker compose --env-file .env --env-file .env.local-ci --profile local-ci up -d --wait postgres-ci
set -a && source .env && source .env.local-ci && set +a
pnpm db:migrate:baseline
```

Do not run `db:bootstrap` against this database. Recreate `postgres-ci` before a
second replay so `public` stays empty; do not `docker compose down -v`.

## Controlled development migrations

Post-bootstrap additive migrations use `scripts/db/deploy-development.mjs` with
`DATABASE_MIGRATION_CONFIRM=DEVELOPMENT_MIGRATION_APPROVED` and a `mall_migrator`
`DIRECT_URL`. The script requires either the exact `0001 -> 0006` predecessor or
the idempotent exact `0001 -> 0007` target. Do not use the runtime connection for
DDL, run migration SQL manually, or edit `_prisma_migrations` directly.
