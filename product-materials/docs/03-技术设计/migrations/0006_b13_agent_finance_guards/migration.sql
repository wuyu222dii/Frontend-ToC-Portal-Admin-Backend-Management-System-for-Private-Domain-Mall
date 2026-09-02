BEGIN;

SET LOCAL lock_timeout = '5s';

-- B13 only installs guards over the existing data model. Keep the historical
-- preflight and all new objects on one stable write boundary so failure leaves
-- neither repaired data nor partial schema residue.
LOCK TABLE
  public."account",
  public."agent_profile",
  public."agent_invite_code",
  public."promotion_asset",
  public."attribution_candidate",
  public."sales_order",
  public."order_item",
  public."refund",
  public."commission_rule_version",
  public."order_item_commission_snapshot",
  public."commission_ledger",
  public."agent_wallet",
  public."agent_bank_account",
  public."withdrawal",
  public."withdrawal_bank_snapshot",
  public."withdrawal_proof"
IN SHARE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."agent_profile" ap
    LEFT JOIN public."account" a ON a."id" = ap."account_id"
    WHERE a."id" IS NULL
      OR a."role" IS DISTINCT FROM 'AGENT_ADMIN'
      OR ap."version" < 1
      OR (ap."status" = 'ACTIVE' AND ap."deleted_at" IS NOT NULL)
      OR (
        ap."contact_phone_ciphertext" IS NOT NULL
        AND (
          octet_length(ap."contact_phone_ciphertext") = 0
          OR ap."contact_phone_last4" !~ '^[0-9]{4}$'
          OR length(btrim(ap."contact_phone_encryption_key_id")) < 3
        )
      )
  ) THEN
    RAISE EXCEPTION 'agent profile contains an invalid AGENT_ADMIN role or state envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."account" a
    LEFT JOIN public."agent_profile" ap ON ap."account_id" = a."id"
    WHERE (a."role" = 'AGENT_ADMIN' AND ap."id" IS NULL)
      OR (a."role" <> 'AGENT_ADMIN' AND ap."id" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'AGENT_ADMIN account and agent profile are not a complete one-to-one pair'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."agent_invite_code" i
    WHERE octet_length(i."code_ciphertext") = 0
      OR i."code_hash" !~ '^[0-9a-f]{64}$'
      OR length(btrim(i."code_last4")) <> 4
      OR length(btrim(i."encryption_key_id")) < 3
      OR (i."expires_at" IS NOT NULL AND i."expires_at" <= i."effective_at")
      OR (i."ended_at" IS NOT NULL AND i."ended_at" < i."effective_at")
      OR ((i."ended_at" IS NULL) <> (i."end_reason" IS NULL))
      OR (i."end_reason" IS NOT NULL AND length(btrim(i."end_reason")) < 2)
      OR (i."status" = 'ACTIVE' AND i."ended_at" IS NOT NULL)
      OR (i."status" IN ('ROTATED', 'EXPIRED') AND i."ended_at" IS NULL)
      OR (i."status" = 'EXPIRED' AND i."expires_at" IS NULL)
      OR (i."status" = 'EXPIRED' AND i."ended_at" < i."expires_at")
  ) THEN
    RAISE EXCEPTION 'agent invite code contains an invalid lifecycle envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."promotion_asset" p
    LEFT JOIN public."agent_invite_code" i ON i."id" = p."invite_code_id"
    WHERE i."id" IS NULL
      OR i."agent_id" IS DISTINCT FROM p."agent_id"
      OR p."authorization_version" < 1
      OR length(btrim(p."public_url")) = 0
      OR (
        (p."target_type" = 'STOREFRONT' AND p."target_product_id" IS NOT NULL)
        OR (p."target_type" = 'PRODUCT' AND p."target_product_id" IS NULL)
      )
      OR (p."expires_at" IS NOT NULL AND p."expires_at" <= p."created_at")
      OR (p."revoked_at" IS NOT NULL AND p."revoked_at" < p."created_at")
      OR (p."status" = 'ACTIVE' AND p."revoked_at" IS NOT NULL)
      OR (p."status" IN ('REVOKED', 'EXPIRED') AND p."revoked_at" IS NULL)
      OR (p."status" = 'EXPIRED' AND p."expires_at" IS NULL)
      OR (p."status" = 'EXPIRED' AND p."revoked_at" < p."expires_at")
  ) THEN
    RAISE EXCEPTION 'promotion asset contains an invalid target, lifecycle, or agent envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."attribution_candidate" c
    LEFT JOIN public."agent_invite_code" i ON i."id" = c."invite_code_id"
    LEFT JOIN public."promotion_asset" p ON p."id" = c."promotion_asset_id"
    WHERE i."id" IS NULL
      OR p."id" IS NULL
      OR i."agent_id" IS DISTINCT FROM c."agent_id"
      OR p."agent_id" IS DISTINCT FROM c."agent_id"
      OR p."invite_code_id" IS DISTINCT FROM c."invite_code_id"
      OR c."expires_at" <= c."created_at"
      OR (c."confirmed_at" IS NOT NULL AND c."confirmed_at" < c."created_at")
      OR (
        c."status" = 'ACTIVE'
        AND (c."confirmed_at" IS NOT NULL OR c."invalid_reason" IS NOT NULL)
      )
      OR (
        c."status" = 'CONFIRMED'
        AND (c."confirmed_at" IS NULL OR c."invalid_reason" IS NOT NULL)
      )
      OR (
        c."status" IN ('REJECTED', 'EXPIRED', 'INVALIDATED')
        AND (
          c."confirmed_at" IS NOT NULL
          OR c."invalid_reason" IS NULL
          OR length(btrim(c."invalid_reason")) < 2
        )
      )
  ) THEN
    RAISE EXCEPTION 'attribution candidate contains an invalid lifecycle or agent envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."commission_rule_version" v
    WHERE v."base_version_id" IS NOT DISTINCT FROM v."id"
      OR (v."status" = 'PUBLISHED' AND v."effective_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'commission rule version contains an invalid lifecycle or base reference'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."order_item_commission_snapshot" s
    LEFT JOIN public."order_item" oi ON oi."id" = s."order_item_id"
    LEFT JOIN public."sales_order" o ON o."id" = oi."order_id"
    WHERE oi."id" IS NULL
      OR o."id" IS NULL
      OR s."category_id_snapshot" IS DISTINCT FROM oi."category_id"
      OR s."product_id_snapshot" IS DISTINCT FROM oi."product_id"
      OR s."sku_id_snapshot" IS DISTINCT FROM oi."sku_id"
      OR s."commission_base" IS DISTINCT FROM oi."line_paid_amount"
      OR s."original_commission" IS DISTINCT FROM round(
        s."commission_base" * s."effective_rate" / 100,
        2
      )
      OR o."final_channel" IS DISTINCT FROM 'AGENT'
      OR o."final_agent_id" IS DISTINCT FROM s."agent_id"
  ) THEN
    RAISE EXCEPTION 'commission snapshot contains an invalid order-item or agent envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."commission_ledger" l
    LEFT JOIN public."order_item_commission_snapshot" s ON s."id" = l."snapshot_id"
    LEFT JOIN public."order_item" oi ON oi."id" = s."order_item_id"
    LEFT JOIN public."refund" r ON r."id" = l."refund_id"
    LEFT JOIN public."withdrawal" w ON w."id" = l."withdrawal_id"
    WHERE (l."snapshot_id" IS NOT NULL AND (
        s."id" IS NULL OR s."agent_id" IS DISTINCT FROM l."agent_id"
      ))
      OR (l."refund_id" IS NOT NULL AND (
        r."id" IS NULL OR oi."id" IS NULL OR r."order_id" IS DISTINCT FROM oi."order_id"
      ))
      OR (l."withdrawal_id" IS NOT NULL AND (
        w."id" IS NULL
        OR w."agent_id" IS DISTINCT FROM l."agent_id"
        OR CASE l."ledger_type"
          WHEN 'WITHDRAWAL_FREEZE' THEN
            -l."available_change" IS DISTINCT FROM w."amount"
            OR l."frozen_change" IS DISTINCT FROM w."amount"
          WHEN 'WITHDRAWAL_RELEASE' THEN
            l."available_change" IS DISTINCT FROM w."amount"
            OR -l."frozen_change" IS DISTINCT FROM w."amount"
          WHEN 'WITHDRAWAL_PAID' THEN
            -l."frozen_change" IS DISTINCT FROM w."amount"
          ELSE TRUE
        END
      ))
      OR NOT (
        (l."ledger_type" = 'EXPECTED_CREATED'
          AND l."snapshot_id" IS NOT NULL
          AND l."refund_id" IS NULL
          AND l."withdrawal_id" IS NULL
          AND l."expected_change" > 0
          AND l."available_change" = 0
          AND l."frozen_change" = 0)
        OR (l."ledger_type" IN ('EXPECTED_REDUCED', 'EXPECTED_CANCELLED')
          AND l."snapshot_id" IS NOT NULL
          AND l."refund_id" IS NOT NULL
          AND l."withdrawal_id" IS NULL
          AND l."expected_change" < 0
          AND l."available_change" = 0
          AND l."frozen_change" = 0)
        OR (l."ledger_type" = 'AVAILABLE_CREDIT'
          AND l."snapshot_id" IS NOT NULL
          AND l."refund_id" IS NULL
          AND l."withdrawal_id" IS NULL
          AND l."expected_change" < 0
          AND l."available_change" = -l."expected_change"
          AND l."frozen_change" = 0)
        OR (l."ledger_type" = 'REFUND_DEBIT'
          AND l."snapshot_id" IS NOT NULL
          AND l."refund_id" IS NOT NULL
          AND l."withdrawal_id" IS NULL
          AND l."expected_change" = 0
          AND l."available_change" < 0
          AND l."frozen_change" = 0)
        OR (l."ledger_type" = 'WITHDRAWAL_FREEZE'
          AND l."snapshot_id" IS NULL
          AND l."refund_id" IS NULL
          AND l."withdrawal_id" IS NOT NULL
          AND l."expected_change" = 0
          AND l."available_change" < 0
          AND l."frozen_change" = -l."available_change")
        OR (l."ledger_type" = 'WITHDRAWAL_RELEASE'
          AND l."snapshot_id" IS NULL
          AND l."refund_id" IS NULL
          AND l."withdrawal_id" IS NOT NULL
          AND l."expected_change" = 0
          AND l."available_change" > 0
          AND l."frozen_change" = -l."available_change")
        OR (l."ledger_type" = 'WITHDRAWAL_PAID'
          AND l."snapshot_id" IS NULL
          AND l."refund_id" IS NULL
          AND l."withdrawal_id" IS NOT NULL
          AND l."expected_change" = 0
          AND l."available_change" = 0
          AND l."frozen_change" < 0)
      )
  ) THEN
    RAISE EXCEPTION 'commission ledger contains an invalid reference or balance-change envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."commission_ledger"
    WHERE "withdrawal_id" IS NOT NULL
    GROUP BY "withdrawal_id", "ledger_type"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'commission ledger contains duplicate withdrawal lifecycle facts'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."agent_wallet"
    WHERE "version" < 1
  ) THEN
    RAISE EXCEPTION 'agent wallet contains an invalid version envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."agent_bank_account" b
    WHERE length(btrim(b."account_holder")) < 2
      OR length(btrim(b."bank_name")) < 2
      OR octet_length(b."account_no_ciphertext") = 0
      OR b."account_no_hash" !~ '^[0-9a-f]{64}$'
      OR b."account_no_last4" !~ '^[0-9]{4}$'
      OR length(btrim(b."encryption_key_id")) < 3
      OR b."version" < 1
      OR (b."deleted_at" IS NOT NULL AND b."is_active")
  ) THEN
    RAISE EXCEPTION 'agent bank account contains an invalid encrypted-value envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."withdrawal" w
    LEFT JOIN public."account" reviewer ON reviewer."id" = w."reviewed_by_id"
    LEFT JOIN public."account" payer ON payer."id" = w."paid_by_id"
    WHERE w."amount" > w."available_before"
      OR w."frozen_after" < w."amount"
      OR w."version" < 1
      OR w."updated_at" < w."created_at"
      OR (w."reviewed_by_id" IS NOT NULL AND reviewer."role" IS DISTINCT FROM 'SUPER_ADMIN')
      OR (w."paid_by_id" IS NOT NULL AND payer."role" IS DISTINCT FROM 'SUPER_ADMIN')
      OR NOT (
        (w."status" = 'PENDING'
          AND num_nonnulls(
            w."review_reason", w."reviewed_by_id", w."reviewed_at",
            w."paid_by_id", w."paid_at"
          ) = 0)
        OR (w."status" = 'APPROVED'
          AND w."review_reason" IS NULL
          AND w."reviewed_by_id" IS NOT NULL
          AND w."reviewed_at" IS NOT NULL
          AND w."paid_by_id" IS NULL
          AND w."paid_at" IS NULL)
        OR (w."status" = 'REJECTED'
          AND w."review_reason" IS NOT NULL
          AND length(btrim(w."review_reason")) >= 2
          AND w."reviewed_by_id" IS NOT NULL
          AND w."reviewed_at" IS NOT NULL
          AND w."paid_by_id" IS NULL
          AND w."paid_at" IS NULL)
        OR (w."status" = 'PAID'
          AND w."review_reason" IS NULL
          AND w."reviewed_by_id" IS NOT NULL
          AND w."reviewed_at" IS NOT NULL
          AND w."paid_by_id" IS NOT NULL
          AND w."paid_at" IS NOT NULL
          AND w."paid_at" >= w."reviewed_at")
      )
  ) THEN
    RAISE EXCEPTION 'withdrawal contains an invalid state, amount, or administrator envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."withdrawal_bank_snapshot" s
    LEFT JOIN public."withdrawal" w ON w."id" = s."withdrawal_id"
    LEFT JOIN public."agent_bank_account" b ON b."id" = s."source_bank_account_id"
    WHERE w."id" IS NULL
      OR b."id" IS NULL
      OR b."agent_id" IS DISTINCT FROM w."agent_id"
      OR s."account_holder" IS DISTINCT FROM b."account_holder"
      OR s."bank_name" IS DISTINCT FROM b."bank_name"
      OR s."account_no_ciphertext" IS DISTINCT FROM b."account_no_ciphertext"
      OR s."account_no_last4" IS DISTINCT FROM b."account_no_last4"
      OR s."encryption_key_id" IS DISTINCT FROM b."encryption_key_id"
      OR length(btrim(s."account_holder")) < 2
      OR length(btrim(s."bank_name")) < 2
      OR octet_length(s."account_no_ciphertext") = 0
      OR s."account_no_last4" !~ '^[0-9]{4}$'
      OR length(btrim(s."encryption_key_id")) < 3
  ) THEN
    RAISE EXCEPTION 'withdrawal bank snapshot contains an invalid immutable source envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."withdrawal" w
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS snapshot_count
      FROM public."withdrawal_bank_snapshot" s
      WHERE s."withdrawal_id" = w."id"
    ) bank ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS proof_count
      FROM public."withdrawal_proof" p
      WHERE p."withdrawal_id" = w."id"
    ) proof ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE l."ledger_type" = 'WITHDRAWAL_FREEZE')::integer AS freeze_count,
        count(*) FILTER (WHERE l."ledger_type" = 'WITHDRAWAL_RELEASE')::integer AS release_count,
        count(*) FILTER (WHERE l."ledger_type" = 'WITHDRAWAL_PAID')::integer AS paid_count
      FROM public."commission_ledger" l
      WHERE l."withdrawal_id" = w."id"
    ) ledger ON TRUE
    WHERE bank.snapshot_count <> 1
      OR ledger.freeze_count <> 1
      OR ledger.release_count <> CASE WHEN w."status" = 'REJECTED' THEN 1 ELSE 0 END
      OR ledger.paid_count <> CASE WHEN w."status" = 'PAID' THEN 1 ELSE 0 END
      OR (w."status" = 'PAID' AND proof.proof_count < 1)
      OR (w."status" NOT IN ('APPROVED', 'PAID') AND proof.proof_count <> 0)
  ) THEN
    RAISE EXCEPTION 'withdrawal contains an incomplete bank snapshot, ledger, or proof envelope'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX "uq_commission_ledger_withdrawal_type"
  ON public."commission_ledger" ("withdrawal_id", "ledger_type")
  WHERE "withdrawal_id" IS NOT NULL;

ALTER TABLE public."agent_profile"
  ADD CONSTRAINT "chk_b13_agent_profile_envelope"
  CHECK (
    "version" >= 1
    AND ("status" <> 'ACTIVE' OR "deleted_at" IS NULL)
    AND (
      "contact_phone_ciphertext" IS NULL
      OR (
        octet_length("contact_phone_ciphertext") > 0
        AND "contact_phone_last4" ~ '^[0-9]{4}$'
        AND length(btrim("contact_phone_encryption_key_id")) >= 3
      )
    )
  );

ALTER TABLE public."agent_invite_code"
  ADD CONSTRAINT "chk_b13_invite_code_lifecycle"
  CHECK (
    octet_length("code_ciphertext") > 0
    AND "code_hash" ~ '^[0-9a-f]{64}$'
    AND length(btrim("code_last4")) = 4
    AND length(btrim("encryption_key_id")) >= 3
    AND ("expires_at" IS NULL OR "expires_at" > "effective_at")
    AND ("ended_at" IS NULL OR "ended_at" >= "effective_at")
    AND (("ended_at" IS NULL) = ("end_reason" IS NULL))
    AND ("end_reason" IS NULL OR length(btrim("end_reason")) >= 2)
    AND ("status" <> 'ACTIVE' OR "ended_at" IS NULL)
    AND ("status" NOT IN ('ROTATED', 'EXPIRED') OR "ended_at" IS NOT NULL)
    AND ("status" <> 'EXPIRED' OR "expires_at" IS NOT NULL)
    AND ("status" <> 'EXPIRED' OR "ended_at" >= "expires_at")
  );

ALTER TABLE public."promotion_asset"
  ADD CONSTRAINT "chk_b13_promotion_asset_envelope"
  CHECK (
    "authorization_version" >= 1
    AND length(btrim("public_url")) > 0
    AND (
      ("target_type" = 'STOREFRONT' AND "target_product_id" IS NULL)
      OR ("target_type" = 'PRODUCT' AND "target_product_id" IS NOT NULL)
    )
    AND ("expires_at" IS NULL OR "expires_at" > "created_at")
    AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
    AND (
      ("status" = 'ACTIVE' AND "revoked_at" IS NULL)
      OR ("status" IN ('REVOKED', 'EXPIRED') AND "revoked_at" IS NOT NULL)
    )
    AND ("status" <> 'EXPIRED' OR (
      "expires_at" IS NOT NULL AND "revoked_at" >= "expires_at"
    ))
  );

ALTER TABLE public."attribution_candidate"
  ADD CONSTRAINT "chk_b13_attribution_candidate_envelope"
  CHECK (
    "expires_at" > "created_at"
    AND ("confirmed_at" IS NULL OR "confirmed_at" >= "created_at")
    AND (
      ("status" = 'ACTIVE' AND "confirmed_at" IS NULL AND "invalid_reason" IS NULL)
      OR ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "invalid_reason" IS NULL)
      OR ("status" IN ('REJECTED', 'EXPIRED', 'INVALIDATED')
        AND "confirmed_at" IS NULL
        AND "invalid_reason" IS NOT NULL
        AND length(btrim("invalid_reason")) >= 2)
    )
  );

ALTER TABLE public."commission_rule_version"
  ADD CONSTRAINT "chk_b13_commission_rule_lifecycle"
  CHECK (
    "base_version_id" IS DISTINCT FROM "id"
    AND ("status" <> 'PUBLISHED' OR "effective_at" IS NOT NULL)
  );

ALTER TABLE public."commission_ledger"
  ADD CONSTRAINT "chk_b13_commission_ledger_shape"
  CHECK (
    ("ledger_type" = 'EXPECTED_CREATED'
      AND "snapshot_id" IS NOT NULL
      AND "refund_id" IS NULL
      AND "withdrawal_id" IS NULL
      AND "expected_change" > 0
      AND "available_change" = 0
      AND "frozen_change" = 0)
    OR ("ledger_type" IN ('EXPECTED_REDUCED', 'EXPECTED_CANCELLED')
      AND "snapshot_id" IS NOT NULL
      AND "refund_id" IS NOT NULL
      AND "withdrawal_id" IS NULL
      AND "expected_change" < 0
      AND "available_change" = 0
      AND "frozen_change" = 0)
    OR ("ledger_type" = 'AVAILABLE_CREDIT'
      AND "snapshot_id" IS NOT NULL
      AND "refund_id" IS NULL
      AND "withdrawal_id" IS NULL
      AND "expected_change" < 0
      AND "available_change" = -"expected_change"
      AND "frozen_change" = 0)
    OR ("ledger_type" = 'REFUND_DEBIT'
      AND "snapshot_id" IS NOT NULL
      AND "refund_id" IS NOT NULL
      AND "withdrawal_id" IS NULL
      AND "expected_change" = 0
      AND "available_change" < 0
      AND "frozen_change" = 0)
    OR ("ledger_type" = 'WITHDRAWAL_FREEZE'
      AND "snapshot_id" IS NULL
      AND "refund_id" IS NULL
      AND "withdrawal_id" IS NOT NULL
      AND "expected_change" = 0
      AND "available_change" < 0
      AND "frozen_change" = -"available_change")
    OR ("ledger_type" = 'WITHDRAWAL_RELEASE'
      AND "snapshot_id" IS NULL
      AND "refund_id" IS NULL
      AND "withdrawal_id" IS NOT NULL
      AND "expected_change" = 0
      AND "available_change" > 0
      AND "frozen_change" = -"available_change")
    OR ("ledger_type" = 'WITHDRAWAL_PAID'
      AND "snapshot_id" IS NULL
      AND "refund_id" IS NULL
      AND "withdrawal_id" IS NOT NULL
      AND "expected_change" = 0
      AND "available_change" = 0
      AND "frozen_change" < 0)
  );

ALTER TABLE public."agent_wallet"
  ADD CONSTRAINT "chk_b13_wallet_version" CHECK ("version" >= 1);

ALTER TABLE public."agent_bank_account"
  ADD CONSTRAINT "chk_b13_bank_account_envelope"
  CHECK (
    length(btrim("account_holder")) >= 2
    AND length(btrim("bank_name")) >= 2
    AND octet_length("account_no_ciphertext") > 0
    AND "account_no_hash" ~ '^[0-9a-f]{64}$'
    AND "account_no_last4" ~ '^[0-9]{4}$'
    AND length(btrim("encryption_key_id")) >= 3
    AND "version" >= 1
    AND ("deleted_at" IS NULL OR NOT "is_active")
  );

ALTER TABLE public."withdrawal"
  ADD CONSTRAINT "chk_b13_withdrawal_envelope"
  CHECK (
    "amount" <= "available_before"
    AND "frozen_after" >= "amount"
    AND "version" >= 1
    AND "updated_at" >= "created_at"
    AND (
      ("status" = 'PENDING'
        AND num_nonnulls(
          "review_reason", "reviewed_by_id", "reviewed_at", "paid_by_id", "paid_at"
        ) = 0)
      OR ("status" = 'APPROVED'
        AND "review_reason" IS NULL
        AND "reviewed_by_id" IS NOT NULL
        AND "reviewed_at" IS NOT NULL
        AND "paid_by_id" IS NULL
        AND "paid_at" IS NULL)
      OR ("status" = 'REJECTED'
        AND "review_reason" IS NOT NULL
        AND length(btrim("review_reason")) >= 2
        AND "reviewed_by_id" IS NOT NULL
        AND "reviewed_at" IS NOT NULL
        AND "paid_by_id" IS NULL
        AND "paid_at" IS NULL)
      OR ("status" = 'PAID'
        AND "review_reason" IS NULL
        AND "reviewed_by_id" IS NOT NULL
        AND "reviewed_at" IS NOT NULL
        AND "paid_by_id" IS NOT NULL
        AND "paid_at" IS NOT NULL
        AND "paid_at" >= "reviewed_at")
    )
  );

ALTER TABLE public."withdrawal_bank_snapshot"
  ADD CONSTRAINT "chk_b13_withdrawal_bank_snapshot_envelope"
  CHECK (
    "source_bank_account_id" IS NOT NULL
    AND length(btrim("account_holder")) >= 2
    AND length(btrim("bank_name")) >= 2
    AND octet_length("account_no_ciphertext") > 0
    AND "account_no_last4" ~ '^[0-9]{4}$'
    AND length(btrim("encryption_key_id")) >= 3
  );

CREATE FUNCTION public.enforce_b13_agent_account_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  account_role public."AccountRole";
BEGIN
  IF TG_TABLE_NAME = 'agent_profile' THEN
    IF TG_OP = 'UPDATE' AND NEW."account_id" IS DISTINCT FROM OLD."account_id" THEN
      RAISE EXCEPTION 'agent profile account_id is immutable';
    END IF;

    SELECT "role" INTO account_role
    FROM public."account"
    WHERE "id" = NEW."account_id"
    FOR SHARE;

    IF account_role IS DISTINCT FROM 'AGENT_ADMIN' THEN
      RAISE EXCEPTION 'agent profile account must have the AGENT_ADMIN role';
    END IF;
  ELSIF NEW."role" IS DISTINCT FROM 'AGENT_ADMIN' AND EXISTS (
    SELECT 1
    FROM public."agent_profile"
    WHERE "account_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'account role cannot leave AGENT_ADMIN while an agent profile exists';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_agent_profile_account_role"
BEFORE INSERT OR UPDATE ON public."agent_profile"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_agent_account_role();

CREATE TRIGGER "trg_b13_agent_account_role"
BEFORE UPDATE OF "role" ON public."account"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_agent_account_role();

CREATE FUNCTION public.enforce_b13_agent_account_coverage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target_account_id TEXT;
  target_account_ids TEXT[];
  account_role public."AccountRole";
  profile_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'account' THEN
    target_account_ids := ARRAY[COALESCE(NEW."id", OLD."id")];
  ELSE
    target_account_ids := ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."account_id" END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."account_id" END
    ];
  END IF;

  FOR target_account_id IN
    SELECT DISTINCT candidate."account_id"
    FROM unnest(target_account_ids) AS candidate("account_id")
    WHERE candidate."account_id" IS NOT NULL
    ORDER BY candidate."account_id"
  LOOP
    SELECT "role" INTO account_role
    FROM public."account"
    WHERE "id" = target_account_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer INTO profile_count
    FROM public."agent_profile"
    WHERE "account_id" = target_account_id;

    IF (account_role = 'AGENT_ADMIN' AND profile_count <> 1)
       OR (account_role <> 'AGENT_ADMIN' AND profile_count <> 0) THEN
      RAISE EXCEPTION 'AGENT_ADMIN account and agent profile must form a complete one-to-one pair';
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "trg_b13_agent_account_coverage_account"
AFTER INSERT OR UPDATE ON public."account"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_agent_account_coverage();

CREATE CONSTRAINT TRIGGER "trg_b13_agent_account_coverage_profile"
AFTER INSERT OR UPDATE OR DELETE ON public."agent_profile"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_agent_account_coverage();

CREATE FUNCTION public.enforce_b13_invite_code_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
     OR NEW."code_hash" IS DISTINCT FROM OLD."code_hash"
     OR NEW."code_ciphertext" IS DISTINCT FROM OLD."code_ciphertext"
     OR NEW."code_last4" IS DISTINCT FROM OLD."code_last4"
     OR NEW."encryption_key_id" IS DISTINCT FROM OLD."encryption_key_id"
     OR NEW."effective_at" IS DISTINCT FROM OLD."effective_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'invite code identity and encrypted value are immutable';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'ACTIVE' AND NEW."status" IN ('DISABLED', 'ROTATED', 'EXPIRED'))
    OR (OLD."status" = 'DISABLED' AND NEW."status" IN ('ACTIVE', 'ROTATED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid invite code lifecycle transition';
  END IF;

  IF OLD."status" IN ('ROTATED', 'EXPIRED') AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."ended_at" IS DISTINCT FROM OLD."ended_at"
    OR NEW."end_reason" IS DISTINCT FROM OLD."end_reason"
  ) THEN
    RAISE EXCEPTION 'terminal invite code lifecycle facts are immutable';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_invite_code_update"
BEFORE UPDATE ON public."agent_invite_code"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_invite_code_update();

CREATE FUNCTION public.enforce_b13_promotion_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  invite_agent_id TEXT;
BEGIN
  SELECT "agent_id" INTO invite_agent_id
  FROM public."agent_invite_code"
  WHERE "id" = NEW."invite_code_id";

  IF invite_agent_id IS DISTINCT FROM NEW."agent_id" THEN
    RAISE EXCEPTION 'promotion asset and invite code must belong to the same agent';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
    OR NEW."invite_code_id" IS DISTINCT FROM OLD."invite_code_id"
    OR NEW."target_type" IS DISTINCT FROM OLD."target_type"
    OR NEW."target_product_id" IS DISTINCT FROM OLD."target_product_id"
    OR NEW."public_url" IS DISTINCT FROM OLD."public_url"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'promotion asset subject, target and public URL are immutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REVOKED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'invalid promotion asset lifecycle transition';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" IN ('REVOKED', 'EXPIRED') AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."authorization_version" IS DISTINCT FROM OLD."authorization_version"
    OR NEW."qr_file_id" IS DISTINCT FROM OLD."qr_file_id"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at"
  ) THEN
    RAISE EXCEPTION 'terminal promotion asset lifecycle facts are immutable';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_promotion_asset"
BEFORE INSERT OR UPDATE ON public."promotion_asset"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_promotion_asset();

CREATE FUNCTION public.enforce_b13_attribution_candidate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  invite_agent_id TEXT;
  promotion_agent_id TEXT;
  promotion_invite_id TEXT;
BEGIN
  SELECT "agent_id" INTO invite_agent_id
  FROM public."agent_invite_code"
  WHERE "id" = NEW."invite_code_id";

  SELECT "agent_id", "invite_code_id"
    INTO promotion_agent_id, promotion_invite_id
  FROM public."promotion_asset"
  WHERE "id" = NEW."promotion_asset_id";

  IF invite_agent_id IS DISTINCT FROM NEW."agent_id"
     OR promotion_agent_id IS DISTINCT FROM NEW."agent_id"
     OR promotion_invite_id IS DISTINCT FROM NEW."invite_code_id" THEN
    RAISE EXCEPTION 'attribution candidate, invite and promotion must share one agent';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
    OR NEW."invite_code_id" IS DISTINCT FROM OLD."invite_code_id"
    OR NEW."promotion_asset_id" IS DISTINCT FROM OLD."promotion_asset_id"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'attribution candidate agent and promotion identity are immutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       NEW."candidate_token_hash" IS DISTINCT FROM OLD."candidate_token_hash"
       OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
     )
     AND NOT (
       OLD."status" = 'ACTIVE'
       AND NEW."status" = 'ACTIVE'
       AND OLD."candidate_token_hash" IS NOT NULL
       AND OLD."customer_id" IS NULL
       AND NEW."candidate_token_hash" IS NULL
       AND NEW."customer_id" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'invalid attribution candidate subject transition';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (
       OLD."status" = 'ACTIVE'
       AND NEW."status" IN ('CONFIRMED', 'REJECTED', 'EXPIRED', 'INVALIDATED')
     ) THEN
    RAISE EXCEPTION 'invalid attribution candidate lifecycle transition';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" <> 'ACTIVE' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."candidate_token_hash" IS DISTINCT FROM OLD."candidate_token_hash"
    OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    OR NEW."invalid_reason" IS DISTINCT FROM OLD."invalid_reason"
  ) THEN
    RAISE EXCEPTION 'terminal attribution candidate facts are immutable';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_attribution_candidate"
BEFORE INSERT OR UPDATE ON public."attribution_candidate"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_attribution_candidate();

CREATE FUNCTION public.enforce_b13_commission_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target_order_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'order_item_commission_snapshot' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public."order_item_commission_snapshot" s
      JOIN public."order_item" oi ON oi."id" = s."order_item_id"
      JOIN public."sales_order" o ON o."id" = oi."order_id"
      WHERE s."id" = COALESCE(NEW."id", OLD."id")
        AND s."category_id_snapshot" = oi."category_id"
        AND s."product_id_snapshot" = oi."product_id"
        AND s."sku_id_snapshot" = oi."sku_id"
        AND s."commission_base" = oi."line_paid_amount"
        AND s."original_commission" = round(
          s."commission_base" * s."effective_rate" / 100,
          2
        )
        AND o."final_channel" = 'AGENT'
        AND o."final_agent_id" = s."agent_id"
    ) THEN
      RAISE EXCEPTION 'commission snapshot must match its paid order item and final agent';
    END IF;
    RETURN NULL;
  END IF;

  target_order_id := COALESCE(NEW."id", OLD."id");
  IF EXISTS (
    SELECT 1
    FROM public."order_item_commission_snapshot" s
    JOIN public."order_item" oi ON oi."id" = s."order_item_id"
    JOIN public."sales_order" o ON o."id" = oi."order_id"
    WHERE oi."order_id" = target_order_id
      AND (
        o."final_channel" IS DISTINCT FROM 'AGENT'
        OR o."final_agent_id" IS DISTINCT FROM s."agent_id"
      )
  ) THEN
    RAISE EXCEPTION 'order final attribution cannot contradict an immutable commission snapshot';
  END IF;

  RETURN NULL;
END $$;

CREATE FUNCTION public.guard_b13_commission_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_order_item_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'order-item commission snapshot is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT oi."id" INTO parent_order_item_id
  FROM public."order_item" oi
  JOIN public."sales_order" o ON o."id" = oi."order_id"
  WHERE oi."id" = NEW."order_item_id"
  FOR SHARE OF oi, o;

  IF parent_order_item_id IS NULL THEN
    RAISE EXCEPTION 'commission snapshot requires an existing order item';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_commission_snapshot_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON public."order_item_commission_snapshot"
FOR EACH ROW EXECUTE FUNCTION public.guard_b13_commission_snapshot();

CREATE CONSTRAINT TRIGGER "trg_b13_commission_snapshot"
AFTER INSERT OR UPDATE ON public."order_item_commission_snapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_commission_snapshot();

CREATE CONSTRAINT TRIGGER "trg_b13_order_commission_snapshot"
AFTER UPDATE ON public."sales_order"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD."final_channel" IS DISTINCT FROM NEW."final_channel"
  OR OLD."final_agent_id" IS DISTINCT FROM NEW."final_agent_id"
)
EXECUTE FUNCTION public.enforce_b13_commission_snapshot();

CREATE FUNCTION public.guard_b13_commission_reference_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF TG_TABLE_NAME = 'order_item' THEN
    IF (
      NEW."order_id" IS DISTINCT FROM OLD."order_id"
      OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
      OR NEW."category_id" IS DISTINCT FROM OLD."category_id"
      OR NEW."sku_id" IS DISTINCT FROM OLD."sku_id"
      OR NEW."line_paid_amount" IS DISTINCT FROM OLD."line_paid_amount"
    ) AND EXISTS (
      SELECT 1
      FROM public."order_item_commission_snapshot"
      WHERE "order_item_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'paid order-item commission source fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'refund' THEN
    IF NEW."order_id" IS DISTINCT FROM OLD."order_id" AND EXISTS (
      SELECT 1
      FROM public."commission_ledger"
      WHERE "refund_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'refund order_id is immutable after commission reversal';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported B13 commission reference parent: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_commission_order_item_parent"
BEFORE UPDATE ON public."order_item"
FOR EACH ROW EXECUTE FUNCTION public.guard_b13_commission_reference_parent();

CREATE TRIGGER "trg_b13_commission_refund_parent"
BEFORE UPDATE OF "order_id" ON public."refund"
FOR EACH ROW EXECUTE FUNCTION public.guard_b13_commission_reference_parent();

CREATE CONSTRAINT TRIGGER "trg_b13_commission_order_item_parent_deferred"
AFTER UPDATE ON public."order_item"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD."order_id" IS DISTINCT FROM NEW."order_id"
  OR OLD."product_id" IS DISTINCT FROM NEW."product_id"
  OR OLD."category_id" IS DISTINCT FROM NEW."category_id"
  OR OLD."sku_id" IS DISTINCT FROM NEW."sku_id"
  OR OLD."line_paid_amount" IS DISTINCT FROM NEW."line_paid_amount"
)
EXECUTE FUNCTION public.guard_b13_commission_reference_parent();

CREATE CONSTRAINT TRIGGER "trg_b13_commission_refund_parent_deferred"
AFTER UPDATE ON public."refund"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD."order_id" IS DISTINCT FROM NEW."order_id")
EXECUTE FUNCTION public.guard_b13_commission_reference_parent();

CREATE FUNCTION public.enforce_b13_commission_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  snapshot_agent_id TEXT;
  snapshot_order_id TEXT;
  refund_order_id TEXT;
  withdrawal_agent_id TEXT;
  withdrawal_amount NUMERIC(18, 2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'commission ledger is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."snapshot_id" IS NOT NULL THEN
    SELECT s."agent_id", oi."order_id"
      INTO snapshot_agent_id, snapshot_order_id
    FROM public."order_item_commission_snapshot" s
    JOIN public."order_item" oi ON oi."id" = s."order_item_id"
    WHERE s."id" = NEW."snapshot_id"
    FOR SHARE OF oi;

    IF snapshot_agent_id IS DISTINCT FROM NEW."agent_id" THEN
      RAISE EXCEPTION 'commission ledger snapshot must belong to the same agent';
    END IF;
  END IF;

  IF NEW."refund_id" IS NOT NULL THEN
    SELECT "order_id" INTO refund_order_id
    FROM public."refund"
    WHERE "id" = NEW."refund_id"
    FOR SHARE;

    IF refund_order_id IS DISTINCT FROM snapshot_order_id THEN
      RAISE EXCEPTION 'commission refund ledger must reference the snapshot order';
    END IF;
  END IF;

  IF NEW."withdrawal_id" IS NOT NULL THEN
    SELECT "agent_id", "amount"
      INTO withdrawal_agent_id, withdrawal_amount
    FROM public."withdrawal"
    WHERE "id" = NEW."withdrawal_id"
    FOR SHARE;

    IF withdrawal_agent_id IS DISTINCT FROM NEW."agent_id" THEN
      RAISE EXCEPTION 'withdrawal ledger must belong to the same agent';
    END IF;

    IF (NEW."ledger_type" = 'WITHDRAWAL_FREEZE' AND (
        -NEW."available_change" IS DISTINCT FROM withdrawal_amount
        OR NEW."frozen_change" IS DISTINCT FROM withdrawal_amount
      ))
      OR (NEW."ledger_type" = 'WITHDRAWAL_RELEASE' AND (
        NEW."available_change" IS DISTINCT FROM withdrawal_amount
        OR -NEW."frozen_change" IS DISTINCT FROM withdrawal_amount
      ))
      OR (NEW."ledger_type" = 'WITHDRAWAL_PAID'
        AND -NEW."frozen_change" IS DISTINCT FROM withdrawal_amount) THEN
      RAISE EXCEPTION 'withdrawal ledger amount must equal the immutable withdrawal amount';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_commission_ledger"
BEFORE INSERT OR UPDATE OR DELETE ON public."commission_ledger"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_commission_ledger();

CREATE FUNCTION public.enforce_b13_withdrawal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  administrator_id TEXT;
  reviewer_role public."AccountRole";
  payer_role public."AccountRole";
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'withdrawal must begin in PENDING';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."withdrawal_no" IS DISTINCT FROM OLD."withdrawal_no"
       OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."available_before" IS DISTINCT FROM OLD."available_before"
       OR NEW."frozen_after" IS DISTINCT FROM OLD."frozen_after"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'withdrawal identity, amount and frozen balance snapshot are immutable';
    END IF;

    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'withdrawal update must increment version exactly once';
    END IF;

    IF NEW."status" IS NOT DISTINCT FROM OLD."status" AND (
      NEW."review_reason" IS DISTINCT FROM OLD."review_reason"
      OR NEW."reviewed_by_id" IS DISTINCT FROM OLD."reviewed_by_id"
      OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
      OR NEW."paid_by_id" IS DISTINCT FROM OLD."paid_by_id"
      OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
    ) THEN
      RAISE EXCEPTION 'withdrawal review and payment decisions change only with status';
    END IF;

    IF OLD."status" = 'APPROVED' AND NEW."status" = 'PAID' AND (
      NEW."review_reason" IS DISTINCT FROM OLD."review_reason"
      OR NEW."reviewed_by_id" IS DISTINCT FROM OLD."reviewed_by_id"
      OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
    ) THEN
      RAISE EXCEPTION 'approved withdrawal review facts are immutable when paid';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
      (OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PAID')
    ) THEN
      RAISE EXCEPTION 'invalid withdrawal lifecycle transition';
    END IF;
  END IF;

  FOR administrator_id IN
    SELECT a."id"
    FROM public."account" a
    WHERE a."id" IN (NEW."reviewed_by_id", NEW."paid_by_id")
    ORDER BY a."id"
    FOR SHARE
  LOOP
    NULL;
  END LOOP;

  IF NEW."reviewed_by_id" IS NOT NULL THEN
    SELECT "role" INTO reviewer_role
    FROM public."account"
    WHERE "id" = NEW."reviewed_by_id";
    IF reviewer_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'withdrawal reviewer must be a SUPER_ADMIN';
    END IF;
  END IF;

  IF NEW."paid_by_id" IS NOT NULL THEN
    SELECT "role" INTO payer_role
    FROM public."account"
    WHERE "id" = NEW."paid_by_id";
    IF payer_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'withdrawal payer must be a SUPER_ADMIN';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_withdrawal"
BEFORE INSERT OR UPDATE ON public."withdrawal"
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_withdrawal();

CREATE FUNCTION public.guard_b13_withdrawal_bank_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  withdrawal_agent_id TEXT;
  source_bank public."agent_bank_account"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'withdrawal bank snapshot is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT "agent_id" INTO withdrawal_agent_id
  FROM public."withdrawal"
  WHERE "id" = NEW."withdrawal_id";

  SELECT * INTO source_bank
  FROM public."agent_bank_account"
  WHERE "id" = NEW."source_bank_account_id"
  FOR SHARE;

  IF withdrawal_agent_id IS NULL
     OR source_bank."id" IS NULL
     OR source_bank."agent_id" IS DISTINCT FROM withdrawal_agent_id
     OR NEW."account_holder" IS DISTINCT FROM source_bank."account_holder"
     OR NEW."bank_name" IS DISTINCT FROM source_bank."bank_name"
     OR NEW."account_no_ciphertext" IS DISTINCT FROM source_bank."account_no_ciphertext"
     OR NEW."account_no_last4" IS DISTINCT FROM source_bank."account_no_last4"
     OR NEW."encryption_key_id" IS DISTINCT FROM source_bank."encryption_key_id" THEN
    RAISE EXCEPTION 'withdrawal bank snapshot must exactly copy a bank account owned by the agent';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_b13_withdrawal_bank_snapshot"
BEFORE INSERT OR UPDATE OR DELETE ON public."withdrawal_bank_snapshot"
FOR EACH ROW EXECUTE FUNCTION public.guard_b13_withdrawal_bank_snapshot();

CREATE FUNCTION public.enforce_b13_withdrawal_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target_withdrawal_id TEXT;
  target_withdrawal_ids TEXT[];
  withdrawal_status public."WithdrawalStatus";
  bank_snapshot_count INTEGER;
  proof_count INTEGER;
  freeze_count INTEGER;
  release_count INTEGER;
  paid_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'withdrawal' THEN
    target_withdrawal_ids := ARRAY[COALESCE(NEW."id", OLD."id")];
  ELSE
    target_withdrawal_ids := ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."withdrawal_id" END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."withdrawal_id" END
    ];
  END IF;

  FOR target_withdrawal_id IN
    SELECT DISTINCT candidate."withdrawal_id"
    FROM unnest(target_withdrawal_ids) AS candidate("withdrawal_id")
    WHERE candidate."withdrawal_id" IS NOT NULL
    ORDER BY candidate."withdrawal_id"
  LOOP
    SELECT "status" INTO withdrawal_status
    FROM public."withdrawal"
    WHERE "id" = target_withdrawal_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer INTO bank_snapshot_count
    FROM public."withdrawal_bank_snapshot"
    WHERE "withdrawal_id" = target_withdrawal_id;

    SELECT count(*)::integer INTO proof_count
    FROM public."withdrawal_proof"
    WHERE "withdrawal_id" = target_withdrawal_id;

    SELECT
      count(*) FILTER (WHERE "ledger_type" = 'WITHDRAWAL_FREEZE')::integer,
      count(*) FILTER (WHERE "ledger_type" = 'WITHDRAWAL_RELEASE')::integer,
      count(*) FILTER (WHERE "ledger_type" = 'WITHDRAWAL_PAID')::integer
      INTO freeze_count, release_count, paid_count
    FROM public."commission_ledger"
    WHERE "withdrawal_id" = target_withdrawal_id;

    IF bank_snapshot_count <> 1 THEN
      RAISE EXCEPTION 'withdrawal requires exactly one immutable bank snapshot';
    END IF;
    IF freeze_count <> 1
       OR release_count <> (CASE WHEN withdrawal_status = 'REJECTED' THEN 1 ELSE 0 END)
       OR paid_count <> (CASE WHEN withdrawal_status = 'PAID' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'withdrawal ledger lifecycle is incomplete or duplicated';
    END IF;
    IF withdrawal_status = 'PAID' AND proof_count < 1 THEN
      RAISE EXCEPTION 'PAID withdrawal requires at least one payment proof';
    END IF;
    IF withdrawal_status NOT IN ('APPROVED', 'PAID') AND proof_count <> 0 THEN
      RAISE EXCEPTION 'payment proof is restricted to APPROVED or PAID withdrawals';
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "trg_b13_withdrawal_consistency_parent"
AFTER INSERT OR UPDATE ON public."withdrawal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_withdrawal_consistency();

CREATE CONSTRAINT TRIGGER "trg_b13_withdrawal_consistency_bank"
AFTER INSERT OR UPDATE OR DELETE ON public."withdrawal_bank_snapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_withdrawal_consistency();

CREATE CONSTRAINT TRIGGER "trg_b13_withdrawal_consistency_proof"
AFTER INSERT OR UPDATE OR DELETE ON public."withdrawal_proof"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_withdrawal_consistency();

CREATE CONSTRAINT TRIGGER "trg_b13_withdrawal_consistency_ledger"
AFTER INSERT OR UPDATE OR DELETE ON public."commission_ledger"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_b13_withdrawal_consistency();

COMMIT;
