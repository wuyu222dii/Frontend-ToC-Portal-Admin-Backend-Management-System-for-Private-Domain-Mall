BEGIN;

SET LOCAL lock_timeout = '5s';

-- Keep the historical preflight and trigger installation on one stable write
-- boundary. Reads remain available while application writes fail fast/retry.
LOCK TABLE
  public."sales_order",
  public."order_item",
  public."aftersale",
  public."aftersale_item",
  public."manual_compensation",
  public."refund",
  public."refund_item",
  public."refund_attempt"
IN SHARE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."refund_attempt"
    WHERE "status" IN ('INITIATED', 'PROCESSING')
    GROUP BY "refund_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'refund attempt contains duplicate active facts per refund'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."refund_attempt"
    WHERE "status" = 'SUCCEEDED'
    GROUP BY "refund_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'refund attempt contains duplicate successful facts per refund'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."refund" r
    JOIN public."sales_order" o ON o."id" = r."order_id"
    LEFT JOIN public."aftersale" a ON a."id" = r."aftersale_id"
    LEFT JOIN public."manual_compensation" mc ON mc."id" = r."manual_compensation_id"
    LEFT JOIN public."order_item" mcoi ON mcoi."id" = mc."order_item_id"
    WHERE
      (r."origin_type" = 'AFTERSALE' AND (
        a."id" IS NULL
        OR a."order_id" <> r."order_id"
        OR a."customer_id" <> o."customer_id"
      ))
      OR
      (r."origin_type" = 'MANUAL_COMPENSATION' AND (
        mc."id" IS NULL
        OR mc."order_id" <> r."order_id"
        OR mc."customer_id" <> o."customer_id"
        OR mcoi."id" IS NULL
        OR mcoi."order_id" <> r."order_id"
      ))
  ) THEN
    RAISE EXCEPTION 'refund contains an invalid order and customer envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."refund_item" ri
    JOIN public."refund" r ON r."id" = ri."refund_id"
    LEFT JOIN public."order_item" oi ON oi."id" = ri."order_item_id"
    LEFT JOIN public."aftersale_item" ai ON ai."id" = ri."aftersale_item_id"
    LEFT JOIN public."manual_compensation" mc ON mc."id" = r."manual_compensation_id"
    WHERE oi."id" IS NULL
      OR oi."order_id" <> r."order_id"
      OR (r."origin_type" = 'AFTERSALE' AND (
        ai."id" IS NULL
        OR ai."aftersale_id" <> r."aftersale_id"
        OR ai."order_item_id" <> ri."order_item_id"
      ))
      OR (r."origin_type" <> 'AFTERSALE' AND ri."aftersale_item_id" IS NOT NULL)
      OR (r."origin_type" = 'MANUAL_COMPENSATION' AND (
        mc."id" IS NULL
        OR ri."order_item_id" <> mc."order_item_id"
        OR ri."quantity" <> 1
      ))
  ) THEN
    RAISE EXCEPTION 'refund item contains an invalid order or aftersale envelope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."refund" r
    LEFT JOIN public."refund_item" ri ON ri."refund_id" = r."id"
    GROUP BY r."id", r."amount"
    HAVING r."amount" IS DISTINCT FROM COALESCE(sum(ri."amount"), 0.00)
  ) THEN
    RAISE EXCEPTION 'refund amount differs from its item total'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX "uq_refund_attempt_one_active_per_refund"
  ON public."refund_attempt" ("refund_id")
  WHERE "status" IN ('INITIATED', 'PROCESSING');

CREATE UNIQUE INDEX "uq_refund_attempt_one_success_per_refund"
  ON public."refund_attempt" ("refund_id")
  WHERE "status" = 'SUCCEEDED';

-- Inspection decisions and items are immutable facts. A row lock on them would
-- require UPDATE privileges that mall_runtime intentionally does not have.
CREATE OR REPLACE FUNCTION public.enforce_refund_item_return_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  refund_origin public."RefundOriginType";
  refund_aftersale_id TEXT;
  aftersale_type public."AftersaleType";
  reserved_quantity INTEGER;
  already_refunded_quantity INTEGER;
  approved_quantity INTEGER;
BEGIN
  SELECT "origin_type", "aftersale_id"
    INTO refund_origin, refund_aftersale_id
  FROM public."refund"
  WHERE "id" = NEW."refund_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund item must reference an existing refund';
  END IF;

  IF refund_origin <> 'AFTERSALE' THEN
    IF NEW."aftersale_item_id" IS NOT NULL THEN
      RAISE EXCEPTION 'non-aftersale refund item cannot reference an aftersale item';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."aftersale_item_id" IS NULL THEN
    RAISE EXCEPTION 'aftersale refund item requires aftersale_item_id';
  END IF;

  SELECT a."type", ai."reserved_qty", ai."refunded_qty"
    INTO aftersale_type, reserved_quantity, already_refunded_quantity
  FROM public."aftersale" a
  JOIN public."aftersale_item" ai
    ON ai."aftersale_id" = a."id"
   AND ai."id" = NEW."aftersale_item_id"
   AND ai."order_item_id" = NEW."order_item_id"
  WHERE a."id" = refund_aftersale_id
  FOR UPDATE OF ai;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund item must belong to the refund aftersale and order item';
  END IF;

  IF NEW."quantity" > reserved_quantity - already_refunded_quantity THEN
    RAISE EXCEPTION 'refund quantity exceeds the remaining aftersale reservation';
  END IF;

  IF aftersale_type = 'RETURN_REFUND' THEN
    SELECT rii."approved_refund_qty"
      INTO approved_quantity
    FROM public."return_inspection" ri
    JOIN public."return_inspection_item" rii
      ON rii."inspection_id" = ri."id"
     AND rii."order_item_id" = NEW."order_item_id"
    WHERE ri."aftersale_id" = refund_aftersale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'returned-goods refund requires a completed inspection item';
    END IF;

    IF NEW."quantity" > approved_quantity - already_refunded_quantity THEN
      RAISE EXCEPTION 'refund quantity exceeds the frozen inspection approval';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.enforce_refund_envelope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target_refund_id TEXT;
  target_refund_ids TEXT[];
  refund_order_id TEXT;
  refund_aftersale_id TEXT;
  refund_manual_compensation_id TEXT;
  refund_origin public."RefundOriginType";
  refund_amount NUMERIC(18, 2);
  order_customer_id TEXT;
  compensation_order_item_id TEXT;
  item_total NUMERIC(18, 2);
BEGIN
  IF TG_TABLE_NAME = 'refund' THEN
    target_refund_ids := ARRAY[NEW."id"];
  ELSIF TG_OP = 'INSERT' THEN
    target_refund_ids := ARRAY[NEW."refund_id"];
  ELSIF TG_OP = 'DELETE' THEN
    target_refund_ids := ARRAY[OLD."refund_id"];
  ELSE
    target_refund_ids := ARRAY[NEW."refund_id", OLD."refund_id"];
  END IF;

  FOR target_refund_id IN
    SELECT DISTINCT candidate."refund_id"
    FROM unnest(target_refund_ids) AS candidate("refund_id")
    WHERE candidate."refund_id" IS NOT NULL
    ORDER BY candidate."refund_id"
  LOOP
    SELECT r."order_id", r."aftersale_id", r."manual_compensation_id",
           r."origin_type", r."amount", o."customer_id", mc."order_item_id"
      INTO refund_order_id, refund_aftersale_id, refund_manual_compensation_id,
           refund_origin, refund_amount, order_customer_id, compensation_order_item_id
    FROM public."refund" r
    JOIN public."sales_order" o ON o."id" = r."order_id"
    LEFT JOIN public."manual_compensation" mc
      ON mc."id" = r."manual_compensation_id"
    WHERE r."id" = target_refund_id
    FOR UPDATE OF r;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF refund_origin = 'AFTERSALE' AND NOT EXISTS (
      SELECT 1
      FROM public."aftersale" a
      WHERE a."id" = refund_aftersale_id
        AND a."order_id" = refund_order_id
        AND a."customer_id" = order_customer_id
    ) THEN
      RAISE EXCEPTION 'refund aftersale must belong to the same order and customer';
    END IF;

    IF refund_origin = 'MANUAL_COMPENSATION' AND NOT EXISTS (
      SELECT 1
      FROM public."manual_compensation" mc
      WHERE mc."id" = refund_manual_compensation_id
        AND mc."order_id" = refund_order_id
        AND mc."customer_id" = order_customer_id
    ) THEN
      RAISE EXCEPTION 'refund compensation must belong to the same order and customer';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public."refund_item" ri
      LEFT JOIN public."order_item" oi ON oi."id" = ri."order_item_id"
      LEFT JOIN public."aftersale_item" ai ON ai."id" = ri."aftersale_item_id"
      WHERE ri."refund_id" = target_refund_id
        AND (
          oi."id" IS NULL
          OR oi."order_id" <> refund_order_id
          OR (refund_origin = 'AFTERSALE' AND (
            ai."id" IS NULL
            OR ai."aftersale_id" <> refund_aftersale_id
            OR ai."order_item_id" <> ri."order_item_id"
          ))
          OR (refund_origin <> 'AFTERSALE' AND ri."aftersale_item_id" IS NOT NULL)
          OR (refund_origin = 'MANUAL_COMPENSATION' AND
              (ri."order_item_id" <> compensation_order_item_id OR ri."quantity" <> 1))
        )
    ) THEN
      RAISE EXCEPTION 'refund items must belong to the refund order and aftersale';
    END IF;

    SELECT COALESCE(sum(ri."amount"), 0.00)
      INTO item_total
    FROM public."refund_item" ri
    WHERE ri."refund_id" = target_refund_id;

    IF refund_amount IS DISTINCT FROM item_total THEN
      RAISE EXCEPTION 'refund amount must equal the sum of its items';
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "trg_refund_envelope_parent"
AFTER INSERT OR UPDATE ON public."refund"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_envelope();

CREATE CONSTRAINT TRIGGER "trg_refund_envelope_items"
AFTER INSERT OR UPDATE OR DELETE ON public."refund_item"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_envelope();

COMMIT;
