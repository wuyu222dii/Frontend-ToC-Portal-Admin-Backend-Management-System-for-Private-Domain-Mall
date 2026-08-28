# Database bootstrap and controlled migrations

The development database is a dedicated Supabase PostgreSQL project in Singapore
(`ap-southeast-1`). Local PostgreSQL is not a supported development fallback.
Only CI may use an explicit disposable PostgreSQL database.

## Secrets and connection roles

Load secrets into the process environment from the approved secret manager. Do
not put them in repository files, command arguments, shell history, or logs.

- `SUPABASE_OWNER_URL`: direct or session-pooler port 5432 URL for `postgres`,
  used only for the first bootstrap. It must include `sslmode=verify-full`.
- `DIRECT_URL`: direct or session-pooler port 5432 URL for `mall_migrator`, used by Prisma Migrate.
  Its password must equal `MALL_MIGRATOR_PASSWORD` during bootstrap.
- `DATABASE_URL`: direct or session-pooler port 5432 URL for `mall_runtime`. Its
  password must equal `MALL_RUNTIME_PASSWORD` during bootstrap.
- `SUPABASE_PROJECT_REF`: the 20-letter development project reference.
- `MALL_MIGRATOR_PASSWORD` and `MALL_RUNTIME_PASSWORD`: independent, generated
  credentials for the two application roles.

Before bootstrap, disable Supabase Data API in the dashboard and set
`SUPABASE_DATA_API_DISABLED_ACK=true`. Project creation is an explicit operation:

```sh
SUPABASE_CREATE_CONFIRM=CREATE_SINGAPORE_DEV_PROJECT \
  node scripts/db/provision-supabase.mjs
```

After the project is active, bootstrap the empty application schema:

```sh
SUPABASE_BOOTSTRAP_CONFIRM=BOOTSTRAP_EMPTY_DEV_DATABASE \
  node scripts/db/bootstrap.mjs
node scripts/db/verify.mjs
node scripts/db/check-drift.mjs
```

The bootstrap applies the frozen `0001_initial` SQL as project owner, sets role
passwords over PostgreSQL stdin, and then runs `prisma migrate resolve` through
`mall_migrator`. It immediately deploys the remaining checked-in migrations,
including `0002_b9_inventory_fact_indexes`, through `mall_migrator`. Prisma
therefore creates and records `_prisma_migrations` itself; the script never
inserts or fabricates a migration-history row. The resulting two-row migration
history is owned by `mall_migrator` and inaccessible to `mall_runtime`. The
operation can be retried after interruption only in an empty or fully registered
B9 state. A baseline-only or otherwise partial state is refused for manual
inspection; the script never resets or overwrites it.

CI replay requires `CI=true`, `ALLOW_CI_EPHEMERAL_POSTGRES=1`, and an empty
local disposable connection in `REPLAY_DATABASE_URL` (or CI `DIRECT_URL`). It
configures the migration role inside the CI-only database and never targets the
Supabase project:

```sh
node scripts/db/replay-ci.mjs
```

## Controlled Supabase development migrations

Post-bootstrap migrations are not applied by the rollback-only smoke workflow.
Run the manual `Supabase development migration` GitHub workflow from `main` and
provide all three inputs:

- the 20-letter development `project_ref`;
- the exact 40-character lowercase `target_sha`, which must equal the current
  `main` commit used to dispatch the workflow;
- `DEVELOPMENT_MIGRATION_APPROVED` as the explicit confirmation.

The protected `supabase-development` environment supplies
`SUPABASE_DIRECT_URL` for `mall_migrator`. The workflow pins and verifies the
Supabase CA, requires a successful `ci.yml` push run for the exact `main` SHA,
validates the project-scoped connection, requires an exact approved predecessor
migration history, performs a read-only baseline check, rejects duplicate
historical inventory business facts, runs `prisma migrate deploy`, and then uses
read-only checks for history, permissions, native index fingerprints, and Prisma
drift. The incremental workflow never runs the privilege-mutating bootstrap
repair SQL. It shares a concurrency group with the
rollback-only smoke workflow, so the two database jobs cannot overlap.

After migration succeeds on the target SHA, run `Supabase development smoke` on
that same `main` SHA, supplying the same exact `target_sha`; the smoke workflow
also requires the matching successful `ci.yml` push run. Do not use the runtime
connection for DDL, run migration SQL manually, or edit `_prisma_migrations`
directly.
