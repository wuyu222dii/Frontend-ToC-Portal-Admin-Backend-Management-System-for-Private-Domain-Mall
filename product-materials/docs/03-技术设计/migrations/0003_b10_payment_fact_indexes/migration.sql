BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."payment_attempt"
    WHERE "status" IN ('SUCCEEDED', 'SUCCEEDED_LATE')
    GROUP BY "payment_intent_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'payment attempt contains duplicate successful facts per intent'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."refund"
    WHERE "origin_type" = 'LATE_PAYMENT'
    GROUP BY "order_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'refund contains duplicate late-payment facts per order'
      USING ERRCODE = '23505';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX "uq_payment_attempt_one_success_per_intent"
  ON public."payment_attempt" ("payment_intent_id")
  WHERE "status" IN ('SUCCEEDED', 'SUCCEEDED_LATE');

CREATE UNIQUE INDEX "uq_refund_one_late_payment_per_order"
  ON public."refund" ("order_id")
  WHERE "origin_type" = 'LATE_PAYMENT';

COMMIT;
