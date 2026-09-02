\set ON_ERROR_STOP on
DO $$
DECLARE
  actual integer;
  actual_hash text;
BEGIN
  SELECT count(*) INTO actual
  FROM pg_roles
  WHERE rolname IN ('authenticator', 'anon', 'authenticated', 'service_role');
  IF actual <> 4 THEN RAISE EXCEPTION 'expected all four Supabase Data API roles, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND c.relname <> '_prisma_migrations';
  IF actual <> 76 THEN RAISE EXCEPTION 'expected 76 application tables, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
    AND pg_get_userbyid(t.typowner) = 'mall_migrator';
  IF actual <> 59 THEN RAISE EXCEPTION 'expected 59 application enums, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND c.relname <> '_prisma_migrations'
    AND i.indpred IS NOT NULL;
  IF actual <> 23 THEN RAISE EXCEPTION 'expected 23 partial indexes, found %', actual; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'inventory_reservation_item'
      AND ic.relname = 'inventory_reservation_item_sku_id_reservation_id_idx'
      AND NOT i.indisunique
      AND i.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'B9 SKU-first inventory reservation index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'inventory_ledger'
      AND ic.relname = 'uq_inventory_ledger_business_fact'
      AND i.indisunique
      AND pg_get_expr(i.indpred, i.indrelid) = '(business_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'B9 inventory ledger business-fact uniqueness index is missing or malformed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_attempt'
      AND ic.relname = 'uq_payment_attempt_one_success_per_intent'
      AND i.indisunique
      AND i.indnatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'payment_intent_id'
      AND pg_get_expr(i.indpred, i.indrelid) =
        '(status = ANY (ARRAY[''SUCCEEDED''::"PaymentAttemptStatus", ''SUCCEEDED_LATE''::"PaymentAttemptStatus"]))'
  ) THEN
    RAISE EXCEPTION 'B10 successful payment-attempt uniqueness index is missing or malformed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'refund'
      AND ic.relname = 'uq_refund_one_late_payment_per_order'
      AND i.indisunique
      AND i.indnatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'order_id'
      AND pg_get_expr(i.indpred, i.indrelid) =
        '(origin_type = ''LATE_PAYMENT''::"RefundOriginType")'
  ) THEN
    RAISE EXCEPTION 'B10 late-payment refund uniqueness index is missing or malformed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'refund_attempt'
      AND ic.relname = 'uq_refund_attempt_one_active_per_refund'
      AND i.indisunique
      AND i.indnatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'refund_id'
      AND pg_get_expr(i.indpred, i.indrelid) =
        '(status = ANY (ARRAY[''INITIATED''::"RefundAttemptStatus", ''PROCESSING''::"RefundAttemptStatus"]))'
  ) THEN
    RAISE EXCEPTION 'B12 active refund-attempt uniqueness index is missing or malformed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'refund_attempt'
      AND ic.relname = 'uq_refund_attempt_one_success_per_refund'
      AND i.indisunique
      AND i.indnatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'refund_id'
      AND pg_get_expr(i.indpred, i.indrelid) =
        '(status = ''SUCCEEDED''::"RefundAttemptStatus")'
  ) THEN
    RAISE EXCEPTION 'B12 successful refund-attempt uniqueness index is missing or malformed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'commission_ledger'
      AND ic.relname = 'uq_commission_ledger_withdrawal_type'
      AND i.indisunique
      AND i.indnatts = 2
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'withdrawal_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'ledger_type'
      AND pg_get_expr(i.indpred, i.indrelid) = '(withdrawal_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'B13 withdrawal ledger lifecycle uniqueness index is missing or malformed';
  END IF;

  SELECT count(*) INTO actual
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'public' AND c.contype = 'c'
    AND pg_get_userbyid(r.relowner) = 'mall_migrator'
    AND r.relname <> '_prisma_migrations';
  IF actual <> 175 THEN RAISE EXCEPTION 'expected 175 CHECK constraints, found %', actual; END IF;
  SELECT count(*) INTO actual
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'public' AND c.contype = 'c'
    AND c.conname LIKE 'chk_b13_%'
    AND pg_get_userbyid(r.relowner) = 'mall_migrator';
  IF actual <> 10 THEN RAISE EXCEPTION 'expected 10 B13 CHECK constraints, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND c.relname <> '_prisma_migrations' AND c.relrowsecurity;
  IF actual <> 76 THEN RAISE EXCEPTION 'expected RLS on 76 application tables, found %', actual; END IF;

  SELECT count(*) INTO actual FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'mall_runtime_access';
  IF actual <> 76 THEN RAISE EXCEPTION 'expected 76 runtime policies, found %', actual; END IF;
  SELECT count(*) INTO actual
  FROM pg_policies p
  JOIN pg_class c ON c.relname = p.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
  WHERE p.schemaname = 'public'
    AND p.policyname = 'mall_runtime_access'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND c.relname <> '_prisma_migrations'
    AND p.permissive = 'PERMISSIVE'
    AND p.roles = ARRAY['mall_runtime']::name[]
    AND p.cmd = 'ALL'
    AND btrim(p.qual) = 'true'
    AND btrim(p.with_check) = 'true';
  IF actual <> 76 THEN
    RAISE EXCEPTION 'all runtime policies must be permissive ALL policies for mall_runtime with true predicates; valid %', actual;
  END IF;
  SELECT count(*) INTO actual
  FROM pg_policies p
  JOIN pg_class c ON c.relname = p.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
  WHERE p.schemaname = 'public'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator'
    AND c.relname <> '_prisma_migrations';
  IF actual <> 76 THEN
    RAISE EXCEPTION 'expected exactly one RLS policy on each application table, found % policies', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual <> 47 THEN RAISE EXCEPTION 'expected 47 user triggers, found %', actual; END IF;

  SELECT coalesce(sum(
    (CASE WHEN (t.tgtype & 4) <> 0 THEN 1 ELSE 0 END) +
    (CASE WHEN (t.tgtype & 8) <> 0 THEN 1 ELSE 0 END) +
    (CASE WHEN (t.tgtype & 16) <> 0 THEN 1 ELSE 0 END) +
    (CASE WHEN (t.tgtype & 32) <> 0 THEN 1 ELSE 0 END)
  ), 0)::integer INTO actual
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual <> 92 THEN RAISE EXCEPTION 'expected 92 trigger event bindings, found %', actual; END IF;

  SELECT count(*) INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'mall_migrator';
  IF actual <> 28 THEN RAISE EXCEPTION 'expected 28 migrator-owned functions, found %', actual; END IF;
  SELECT count(*) INTO actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND (p.proname LIKE 'enforce_b13_%' OR p.proname LIKE 'guard_b13_%')
    AND pg_get_userbyid(p.proowner) = 'mall_migrator'
    AND l.lanname = 'plpgsql'
    AND p.prokind = 'f'
    AND NOT p.prosecdef
    AND p.proconfig IS NULL;
  IF actual <> 12 THEN
    RAISE EXCEPTION 'expected 12 owner-locked SECURITY INVOKER B13 guard functions, found %', actual;
  END IF;
  SELECT md5(string_agg(concat_ws(E'\x1f',
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    pg_get_function_result(p.oid),
    l.lanname,
    p.prokind::text,
    p.provolatile::text,
    p.proparallel::text,
    p.proisstrict::text,
    p.prosecdef::text,
    p.proleakproof::text,
    coalesce(array_to_string(p.proconfig, E'\x1e'), ''),
    p.prosrc
  ), E'\x1d' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) INTO actual_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'mall_migrator';
  IF actual_hash <> 'af58e950c026d83e837f87edbef2f314' THEN
    RAISE EXCEPTION 'application function definitions differ from the frozen B13 baseline: %', actual_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_commission_position_snapshot'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND NOT p.prosecdef
      AND position('FOR SHARE' IN upper(p.prosrc)) = 0
  ) THEN
    RAISE EXCEPTION 'commission position trigger function is not the CH-023 SECURITY INVOKER definition';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_refund_item_return_limit'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND NOT p.prosecdef
      AND position('FOR SHARE OF RI, RII' IN upper(p.prosrc)) = 0
      AND position('WHERE "ID" = NEW."REFUND_ID"' IN upper(p.prosrc)) > 0
      AND position('FOR UPDATE' IN upper(p.prosrc)) > 0
  ) THEN
    RAISE EXCEPTION 'refund item return-limit function is not the B12 SECURITY INVOKER definition';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_refund_envelope'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND NOT p.prosecdef
      AND position('REFUND AMOUNT MUST EQUAL THE SUM OF ITS ITEMS' IN upper(p.prosrc)) > 0
      AND position('MANUAL_COMPENSATION' IN upper(p.prosrc)) > 0
      AND position('RI."QUANTITY" <> 1' IN upper(p.prosrc)) > 0
      AND position('ORDER BY CANDIDATE."REFUND_ID"' IN upper(p.prosrc)) > 0
      AND position('FOR UPDATE OF R' IN upper(p.prosrc)) > 0
  ) THEN
    RAISE EXCEPTION 'refund envelope function is not the B12 SECURITY INVOKER definition';
  END IF;

  SELECT md5(string_agg(concat_ws(E'\x1f',
    c.relname,
    t.tgname,
    pf.proname,
    pg_get_function_identity_arguments(pf.oid),
    t.tgtype::text,
    t.tgenabled::text,
    t.tgdeferrable::text,
    t.tginitdeferred::text,
    t.tgattr::text,
    encode(t.tgargs, 'hex'),
    pg_get_triggerdef(t.oid, false),
    coalesce(t.tgoldtable, ''),
    coalesce(t.tgnewtable, '')
  ), E'\x1d' ORDER BY c.relname, t.tgname)) INTO actual_hash
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc pf ON pf.oid = t.tgfoid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual_hash <> '3d1547c613fd1f82c139a94dc0b2cc95' THEN
    RAISE EXCEPTION 'application trigger definitions differ from the frozen baseline: %', actual_hash;
  END IF;

  SELECT md5(string_agg(concat_ws(E'\x1f',
    c.relname,
    k.conname,
    pg_get_expr(k.conbin, k.conrelid),
    k.condeferrable::text,
    k.condeferred::text,
    k.convalidated::text,
    k.connoinherit::text
  ), E'\x1d' ORDER BY c.relname, k.conname)) INTO actual_hash
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND k.contype = 'c'
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual_hash <> 'aa50500fa26840d5728dedae27b5c9b1' THEN
    RAISE EXCEPTION 'application CHECK definitions differ from the frozen baseline: %', actual_hash;
  END IF;

  SELECT md5(string_agg(concat_ws(E'\x1f',
    c.relname,
    ic.relname,
    i.indisunique::text,
    i.indisvalid::text,
    i.indisready::text,
    i.indislive::text,
    i.indnullsnotdistinct::text,
    pg_get_indexdef(i.indexrelid),
    pg_get_expr(i.indpred, i.indrelid)
  ), E'\x1d' ORDER BY c.relname, ic.relname)) INTO actual_hash
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND i.indpred IS NOT NULL
    AND pg_get_userbyid(c.relowner) = 'mall_migrator';
  IF actual_hash <> 'e0fdfdd16fcbb5640ce584f3a9981ceb' THEN
    RAISE EXCEPTION 'partial-index definitions differ from the frozen baseline: %', actual_hash;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['authenticator', 'anon', 'authenticated', 'service_role']) AS denied(role_name)
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'mall_migrator'
      AND has_function_privilege(denied.role_name, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'a Data API role can execute an application function';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
      ON TRUE
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'enforce_b13_%' OR p.proname LIKE 'guard_b13_%')
      AND privilege.privilege_type = 'EXECUTE'
      AND (
        privilege.grantee = 0
        OR grantee_role.rolname IN (
          'mall_runtime', 'authenticator', 'anon', 'authenticated', 'service_role'
        )
      )
  ) THEN
    RAISE EXCEPTION 'a runtime, PUBLIC, or Data API role can execute a B13 guard function';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    WHERE owner_role.rolname = 'mall_migrator'
      AND d.defaclnamespace = 0
      AND d.defaclobjtype = 'f'
  ) OR EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) privilege
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
    WHERE owner_role.rolname = 'mall_migrator'
      AND d.defaclobjtype = 'f'
      AND (d.defaclnamespace = 0 OR n.nspname = 'public')
      AND privilege.privilege_type = 'EXECUTE'
      AND (
        privilege.grantee = 0
        OR grantee_role.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
        OR (d.defaclnamespace = 0 AND grantee_role.rolname = 'mall_runtime')
      )
  ) THEN
    RAISE EXCEPTION 'mall_migrator global function defaults expose Data API execution';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) privilege
    JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
    WHERE owner_role.rolname = 'mall_migrator'
      AND n.nspname = 'public'
      AND d.defaclobjtype = 'f'
      AND grantee_role.rolname = 'mall_runtime'
      AND privilege.privilege_type = 'EXECUTE'
      AND NOT privilege.is_grantable
  ) THEN
    RAISE EXCEPTION 'mall_migrator public function defaults omit mall_runtime execution';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(p.proacl) privilege
    JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'mall_migrator'
      AND grantee_role.rolname = 'mall_runtime'
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.is_grantable
  ) THEN
    RAISE EXCEPTION 'mall_runtime can grant execution on an application function';
  END IF;

  SELECT count(*) INTO actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_get_userbyid(p.proowner) = 'mall_migrator'
    AND has_function_privilege('mall_runtime', p.oid, 'EXECUTE');
  IF actual <> 16 THEN
    RAISE EXCEPTION 'expected mall_runtime EXECUTE on 16 non-B13 application functions, found %', actual;
  END IF;

  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Prisma migration history table is missing';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass)
     <> 'mall_migrator' THEN
    RAISE EXCEPTION 'Prisma migration history is not owned by mall_migrator';
  END IF;
  IF (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0001_initial'
      AND checksum = 'f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0002_b9_inventory_fact_indexes'
      AND checksum = '9c933d256e0cbe7c33acdd801b6385bae6f892ff3db10978c40e37ea2f89f5d0'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0003_b10_payment_fact_indexes'
      AND checksum = '0d5109a6d0eab2598f2c6c98bbeca265bdd32733e7d89f8eb78eff67caedb836'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0004_b10_commission_position_trigger_fix'
      AND checksum = '8d4c391af114c4691d2be80ae8bb44efc1c70658f5268ad4de7221a29d5ee102'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0005_b12_aftersale_refund_guards'
      AND checksum = '95f362667bdc6a0b751ae636d91a139a71a3f40155ba764937db01d5bbce412b'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
    WHERE migration_name = '0006_b13_agent_finance_guards'
      AND checksum = '355311f6a5091f03bcb879f927ca78c984ec2cb26efb7f14bb4133161ccc2ea0'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 OR (
    SELECT count(*) FROM public._prisma_migrations
  ) <> 6 OR EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE finished_at IS NULL
      OR rolled_back_at IS NOT NULL
      OR migration_name NOT IN (
        '0001_initial',
        '0002_b9_inventory_fact_indexes',
        '0003_b10_payment_fact_indexes',
        '0004_b10_commission_position_trigger_fix',
        '0005_b12_aftersale_refund_guards',
        '0006_b13_agent_finance_guards'
      )
  ) THEN
    RAISE EXCEPTION 'expected the exact completed 0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006 B13 migration history';
  END IF;
  IF has_table_privilege('mall_runtime', 'public._prisma_migrations', 'SELECT')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'INSERT')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'UPDATE')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'DELETE')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'TRUNCATE')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'REFERENCES')
    OR has_table_privilege('mall_runtime', 'public._prisma_migrations', 'TRIGGER') THEN
    RAISE EXCEPTION 'mall_runtime can access Prisma migration history';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['authenticator', 'anon', 'authenticated', 'service_role']) AS denied(role_name)
    WHERE has_table_privilege(denied.role_name, 'public._prisma_migrations', 'SELECT')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'INSERT')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'UPDATE')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'DELETE')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'TRUNCATE')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'REFERENCES')
      OR has_table_privilege(denied.role_name, 'public._prisma_migrations', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'a Data API role can access Prisma migration history';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('mall_runtime', 'mall_migrator')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'application database roles are over-privileged'; END IF;
  IF has_schema_privilege('mall_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'mall_runtime can create objects in public schema';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['authenticator', 'anon', 'authenticated', 'service_role']) AS denied(role_name)
    WHERE has_schema_privilege(denied.role_name, 'public', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'a Data API role can create objects in public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND has_table_privilege('mall_runtime', c.oid, 'DELETE')
      AND c.relname NOT IN (
        'favorite',
        'cart_item',
        'customer_phone_verification',
        'customer_address'
      )
  ) THEN
    RAISE EXCEPTION 'mall_runtime has DELETE on a protected application table';
  END IF;
  SELECT count(*) INTO actual
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations'
    AND has_table_privilege('mall_runtime', c.oid, 'DELETE');
  IF actual <> 4 THEN
    RAISE EXCEPTION 'expected DELETE on exactly four account-cleanup tables, found %', actual;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND (
        has_table_privilege('mall_runtime', c.oid, 'TRUNCATE')
        OR has_table_privilege('mall_runtime', c.oid, 'REFERENCES')
        OR has_table_privilege('mall_runtime', c.oid, 'TRIGGER')
      )
  ) THEN
    RAISE EXCEPTION 'mall_runtime has a forbidden non-DML application table privilege';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND has_sequence_privilege(
        'mall_runtime',
        format('%I.%I', n.nspname, c.relname),
        'UPDATE'
      )
  ) THEN
    RAISE EXCEPTION 'mall_runtime can set an application sequence value';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (
        'consent_record',
        'binding_change_log',
        'inventory_ledger',
        'order_address_snapshot',
        'order_attribution_snapshot',
        'shipment_item',
        'logistics_event',
        'aftersale_evidence',
        'return_address_snapshot',
        'return_inspection_item',
        'refund_item',
        'commission_rule_entry',
        'order_item_commission_snapshot',
        'commission_ledger',
        'withdrawal_bank_snapshot',
        'withdrawal_proof',
        'audit_log'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('mall_runtime', c.oid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'mall_runtime can UPDATE an immutable application fact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = 'callback_inbox'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('status', 'retry_count', 'processed_at', 'error_message')
      AND has_column_privilege('mall_runtime', c.oid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'mall_runtime can UPDATE a protected callback_inbox column';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('callback_inbox'::text, 'status'::text),
      ('callback_inbox', 'retry_count'),
      ('callback_inbox', 'processed_at'),
      ('callback_inbox', 'error_message'),
      ('return_inspection', 'resolution'),
      ('return_inspection', 'resolution_note'),
      ('return_inspection', 'resolved_at'),
      ('return_inspection', 'version'),
      ('return_inspection', 'updated_at')
    ) AS required_updates(table_name, column_name)
    WHERE NOT has_column_privilege(
      'mall_runtime',
      format('public.%I', required_updates.table_name)::regclass,
      required_updates.column_name,
      'UPDATE'
    )
  ) THEN
    RAISE EXCEPTION 'mall_runtime is missing a required controlled UPDATE column grant';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = 'return_inspection'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('resolution', 'resolution_note', 'resolved_at', 'version', 'updated_at')
      AND has_column_privilege('mall_runtime', c.oid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'mall_runtime can UPDATE a forbidden return_inspection column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = 'mall_runtime'
      AND (m.set_option OR granted_role.rolsuper OR granted_role.rolcreatedb
        OR granted_role.rolcreaterole OR granted_role.rolreplication OR granted_role.rolbypassrls)
  ) THEN RAISE EXCEPTION 'mall_runtime can SET ROLE to a privileged role'; END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['authenticator', 'anon', 'authenticated', 'service_role']) AS denied(role_name)
    CROSS JOIN pg_roles reachable
    WHERE reachable.rolname <> denied.role_name
      AND NOT (
        denied.role_name = 'authenticator'
        AND reachable.rolname IN ('anon', 'authenticated', 'service_role')
      )
      AND (
        pg_has_role(denied.role_name, reachable.oid, 'MEMBER')
        OR pg_has_role(denied.role_name, reachable.oid, 'SET')
        OR pg_has_role(denied.role_name, reachable.oid, 'USAGE')
      )
  ) THEN
    RAISE EXCEPTION 'a Data API role can inherit or SET ROLE outside the approved Supabase role graph';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND pg_get_userbyid(c.relowner) = 'mall_runtime'
  ) THEN RAISE EXCEPTION 'mall_runtime owns an application table'; END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    JOIN pg_policies p
      ON p.schemaname = g.table_schema AND p.tablename = g.table_name
    WHERE p.schemaname = 'public' AND p.policyname = 'mall_runtime_access'
      AND g.grantee IN ('authenticator', 'anon', 'authenticated', 'service_role')
  ) THEN RAISE EXCEPTION 'a Data API role has application table privileges'; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_roles denied
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND denied.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
      AND (
        has_table_privilege(denied.rolname, c.oid, 'SELECT')
        OR has_table_privilege(denied.rolname, c.oid, 'INSERT')
        OR has_table_privilege(denied.rolname, c.oid, 'UPDATE')
        OR has_table_privilege(denied.rolname, c.oid, 'DELETE')
        OR has_table_privilege(denied.rolname, c.oid, 'TRUNCATE')
        OR has_table_privilege(denied.rolname, c.oid, 'REFERENCES')
        OR has_table_privilege(denied.rolname, c.oid, 'TRIGGER')
      )
  ) THEN RAISE EXCEPTION 'a Data API role has effective application table privileges'; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    CROSS JOIN pg_roles denied
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND denied.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
      AND (
        has_column_privilege(denied.rolname, c.oid, a.attnum, 'SELECT')
        OR has_column_privilege(denied.rolname, c.oid, a.attnum, 'INSERT')
        OR has_column_privilege(denied.rolname, c.oid, a.attnum, 'UPDATE')
        OR has_column_privilege(denied.rolname, c.oid, a.attnum, 'REFERENCES')
      )
  ) THEN RAISE EXCEPTION 'a Data API role has effective application column privileges'; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN pg_roles denied
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND denied.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
      AND (
        has_sequence_privilege(denied.rolname, format('%I.%I', n.nspname, c.relname), 'USAGE')
        OR has_sequence_privilege(denied.rolname, format('%I.%I', n.nspname, c.relname), 'SELECT')
        OR has_sequence_privilege(denied.rolname, format('%I.%I', n.nspname, c.relname), 'UPDATE')
      )
  ) THEN RAISE EXCEPTION 'a Data API role has effective application sequence privileges'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname <> 'mall_runtime_access'
      AND (roles && ARRAY['authenticator', 'anon', 'authenticated', 'service_role']::name[])
      AND tablename IN (
        SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'mall_runtime_access'
      )
  ) THEN RAISE EXCEPTION 'a Data API role has an application RLS policy'; END IF;
END $$;

SELECT json_build_object(
  'tables', 76,
  'enums', 59,
  'partial_indexes', 23,
  'check_constraints', 175,
  'rls_tables', 76,
  'runtime_policies', 76,
  'runtime_policy_shape_verified', true,
  'user_triggers', 47,
  'trigger_event_bindings', 92,
  'owned_functions', 28,
  'native_definition_fingerprints_verified', true,
  'runtime_function_execute', 16,
  'supabase_data_api_roles', 4,
  'data_api_function_execute_denied', true,
  'data_api_effective_table_privileges_denied', true,
  'data_api_effective_column_privileges_denied', true,
  'data_api_effective_sequence_privileges_denied', true,
  'data_api_application_role_escalation_denied', true,
  'runtime_return_inspection_update_allowlist', true,
  'runtime_non_dml_table_privileges_denied', true,
  'runtime_sequence_update_denied', true,
  'migration_history_owner', 'mall_migrator',
  'status', 'passed'
)::text;
