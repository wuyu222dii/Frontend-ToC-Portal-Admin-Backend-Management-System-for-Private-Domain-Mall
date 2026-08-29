BEGIN;

-- The immutable snapshot can be validated without a row lock, which would
-- require a table privilege that mall_runtime intentionally does not hold.
CREATE OR REPLACE FUNCTION public.enforce_commission_position_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  snapshot_original NUMERIC(18, 2);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."snapshot_id" IS DISTINCT FROM OLD."snapshot_id" THEN
    RAISE EXCEPTION 'commission position snapshot_id is immutable';
  END IF;

  SELECT "original_commission"
    INTO snapshot_original
  FROM public."order_item_commission_snapshot"
  WHERE "id" = NEW."snapshot_id";

  IF NOT FOUND OR NEW."original_commission" IS DISTINCT FROM snapshot_original THEN
    RAISE EXCEPTION 'commission position original amount must equal its immutable snapshot';
  END IF;

  RETURN NEW;
END $$;

COMMIT;
