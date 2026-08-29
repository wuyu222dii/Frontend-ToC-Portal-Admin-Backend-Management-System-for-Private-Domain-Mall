\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  member_name text;
  granted_name text;
BEGIN
  FOREACH member_name IN ARRAY ARRAY['authenticator', 'anon', 'authenticated', 'service_role']
  LOOP
    FOREACH granted_name IN ARRAY ARRAY['mall_runtime', 'mall_migrator']
    LOOP
      IF pg_has_role(member_name, granted_name, 'MEMBER')
        OR pg_has_role(member_name, granted_name, 'SET')
        OR pg_has_role(member_name, granted_name, 'USAGE') THEN
        EXECUTE format('REVOKE %I FROM %I', granted_name, member_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
SET LOCAL ROLE mall_migrator;

DO $$
BEGIN
  IF to_regclass('public.account') IS NULL THEN
    RAISE EXCEPTION 'baseline application tables are missing';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Prisma migration history is missing; do not fabricate it';
  END IF;
  IF (
    SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name = '0001_initial'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name = '0002_b9_inventory_fact_indexes'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name = '0003_b10_payment_fact_indexes'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name = '0004_b10_commission_position_trigger_fix'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public."_prisma_migrations"
  ) <> 4 OR EXISTS (
    SELECT 1 FROM public."_prisma_migrations"
    WHERE finished_at IS NULL
      OR rolled_back_at IS NOT NULL
      OR migration_name NOT IN (
        '0001_initial',
        '0002_b9_inventory_fact_indexes',
        '0003_b10_payment_fact_indexes',
        '0004_b10_commission_position_trigger_fix'
      )
  ) THEN
    RAISE EXCEPTION 'Prisma migration history is not the exact completed CH-023 migration chain';
  END IF;
  IF (
    SELECT pg_get_userbyid(relowner)
    FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass
  ) <> 'mall_migrator' THEN
    RAISE EXCEPTION 'Prisma migration history was not created by mall_migrator';
  END IF;
END $$;

REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations"
  FROM PUBLIC, mall_runtime, authenticator, anon, authenticated, service_role;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM authenticator, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM authenticator, anon, authenticated, service_role;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM mall_runtime;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public
  FROM mall_runtime;

DO $$
DECLARE
  application_function regprocedure;
BEGIN
  FOR application_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'mall_migrator'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticator, anon, authenticated, service_role',
      application_function
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO mall_runtime',
      application_function
    );
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, authenticator, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO mall_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticator, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticator, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM mall_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM mall_runtime;

COMMIT;
