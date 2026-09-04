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
including `0002_b9_inventory_fact_indexes` and `0003_b10_payment_fact_indexes`,
plus the CH-023 `0004_b10_commission_position_trigger_fix` and the CH-026
`0005_b12_aftersale_refund_guards`, followed by the CH-028
`0006_b13_agent_finance_guards`, through `mall_migrator`. Prisma
therefore creates and records `_prisma_migrations` itself; the script never
inserts or fabricates a migration-history row. The resulting six-row migration
history is owned by `mall_migrator` and inaccessible to `mall_runtime`. The
operation can be retried after interruption only in an empty or fully registered
B13 state. A baseline-only or otherwise partial state is refused for manual
inspection; the script never resets or overwrites it.

After the first `SUPER_ADMIN` exists and the legal retention period has external
approval, provision the initial published business rules once:

```sh
BUSINESS_RULE_BOOTSTRAP_ADMIN_ID='<active-super-admin-ulid>' \
BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS='<approved-integer-1-to-100>' \
  pnpm admin:bootstrap-business-rules
```

The command fixes the approved development defaults at a 100 yuan minimum
withdrawal, a 7-day aftersale window, and a 30-minute payment timeout. It does
not guess the legal retention period, refuses any existing rule history, verifies
the named account is an active `SUPER_ADMIN`, and creates the published rule and
its immutable audit record in one serializable transaction. Keep these one-shot
values out of `.env`; inject them from the controlled deployment environment and
unset them immediately after use.

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
validates the project-scoped connection and checksum-complete migration history,
requiring either the exact `0001 -> 0005` predecessor or the idempotent exact
`0001 -> 0006` target. Only the predecessor runs the B13 migration-time historical
preflight; an already deployed `0006` skips that one-time predicate and proceeds to
the no-op deploy plus post-verification, so a later bank-card change cannot invalidate
an immutable withdrawal snapshot. The deploy also preflights the B9-B12 uniqueness
and refund envelopes before running `prisma migrate deploy`. Migration `0006` acquires a
five-second, fail-fast `SHARE` write boundary over every table read by its preflight
or guarded by its triggers, then repeats those checks transactionally. The workflow
reconciles function privileges and finally uses read-only checks for exact history,
permissions, native object fingerprints, and Prisma drift. A successful run publishes
an attestation bound to the exact main SHA and Supabase project reference. The
rollback-only smoke requires that attestation from a successful migration run created
before the smoke run; dispatch the smoke only after migration completes. Both workflows
share one database concurrency group, so they cannot execute concurrently.

Pause development writers before dispatching `0006`; the short lock timeout is an
intentional fail-closed control, not an online-migration retry loop. If deploy fails,
inspect the exact `_prisma_migrations` row and database error before using the
approved Prisma recovery procedure. Do not blindly rerun the workflow or edit
migration history by hand.

After migration succeeds on the target SHA, run `Supabase development smoke` on
that same `main` SHA, supplying the same exact `target_sha`; the smoke workflow
also requires the matching successful `ci.yml` push run. Do not use the runtime
connection for DDL, run migration SQL manually, or edit `_prisma_migrations`
directly.
