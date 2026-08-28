BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."inventory_ledger"
    WHERE "business_id" IS NOT NULL
    GROUP BY "business_id", "sku_id", "ledger_type"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'inventory ledger contains duplicate non-null business facts'
      USING ERRCODE = '23505';
  END IF;
END
$migration$;

CREATE INDEX "inventory_reservation_item_sku_id_reservation_id_idx"
  ON public."inventory_reservation_item" ("sku_id", "reservation_id");

CREATE UNIQUE INDEX "uq_inventory_ledger_business_fact"
  ON public."inventory_ledger" ("business_id", "sku_id", "ledger_type")
  WHERE "business_id" IS NOT NULL;

COMMIT;
