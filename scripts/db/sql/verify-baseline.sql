\set ON_ERROR_STOP on
DO $$
DECLARE
  actual integer;
BEGIN
  SELECT count(*) INTO actual
  FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'mall_runtime_access';
  IF actual <> 76 THEN RAISE EXCEPTION 'expected 76 baseline application tables, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
    AND pg_get_userbyid(t.typowner) = 'mall_migrator';
  IF actual <> 59 THEN RAISE EXCEPTION 'expected 59 baseline enums, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND i.indpred IS NOT NULL;
  IF actual <> 17 THEN RAISE EXCEPTION 'expected 17 baseline partial indexes, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND k.contype = 'c'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual <> 165 THEN RAISE EXCEPTION 'expected 165 baseline CHECK constraints, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual <> 24 THEN RAISE EXCEPTION 'expected 24 baseline user triggers, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'mall_migrator';
  IF actual <> 15 THEN RAISE EXCEPTION 'expected 15 baseline functions, found %', actual; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies p
    JOIN pg_class c ON c.relname = p.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
    WHERE p.schemaname = 'public' AND p.policyname = 'mall_runtime_access'
      AND (pg_get_userbyid(c.relowner) <> 'mall_migrator' OR NOT c.relrowsecurity)
  ) THEN RAISE EXCEPTION 'a baseline table has incorrect ownership or RLS state'; END IF;
END $$;
