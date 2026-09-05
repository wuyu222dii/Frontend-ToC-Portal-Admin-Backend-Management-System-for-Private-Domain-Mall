BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE
  public."file_asset",
  public."outbox_event",
  public."product_image",
  public."brand",
  public."category",
  public."product",
  public."sku",
  public."banner",
  public."promotion_asset",
  public."aftersale_evidence",
  public."withdrawal_proof",
  public."commission_rule_entry"
IN SHARE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."file_asset" f
    WHERE f."status" = 'READY'
      AND (
        f."deleted_at" IS NOT NULL
        OR f."visibility" IS DISTINCT FROM CASE
          WHEN f."purpose" IN ('PRODUCT_IMAGE', 'BRAND_LOGO', 'CATEGORY_ICON', 'BANNER')
            THEN 'PUBLIC'::public."FileVisibility"
          ELSE 'PRIVATE'::public."FileVisibility"
        END
        OR f."object_key" IS DISTINCT FROM CASE
          WHEN f."purpose" IN ('PRODUCT_IMAGE', 'BRAND_LOGO', 'CATEGORY_ICON', 'BANNER')
            THEN 'public/' || f."id"
          ELSE 'private/' || f."id"
        END
        OR (
          SELECT count(*)
          FROM public."outbox_event" e
          WHERE e."aggregate_type" = 'file'
            AND e."aggregate_id" = f."id"
            AND e."event_type" = 'file.staging_cleanup_requested'
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM public."outbox_event" e
          WHERE e."aggregate_type" = 'file'
            AND e."aggregate_id" = f."id"
            AND e."event_type" = 'file.staging_cleanup_requested'
            AND (
              e."created_at" < f."created_at"
              OR e."payload" IS DISTINCT FROM jsonb_build_object(
                'event_version', 1,
                'resource_type', 'file',
                'resource_id', f."id",
                'resource_version', 1
              )
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'READY file history has an invalid envelope or completion event'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."commission_rule_entry" e
    LEFT JOIN public."category" c
      ON e."target_type" = 'CATEGORY' AND c."id" = e."target_id"
    LEFT JOIN public."sku" s
      ON e."target_type" = 'SKU' AND s."id" = e."target_id"
    LEFT JOIN public."product" p ON p."id" = s."product_id"
    WHERE (e."target_type" = 'CATEGORY' AND (
        c."id" IS NULL OR length(btrim(c."name")) = 0
      ))
      OR (e."target_type" = 'SKU' AND (
        s."id" IS NULL OR p."id" IS NULL
        OR length(btrim(p."name")) = 0 OR length(btrim(s."code")) = 0
      ))
  ) THEN
    RAISE EXCEPTION 'commission rule history contains an unresolvable target name'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX "uq_file_staging_cleanup_event_per_file"
  ON public."outbox_event" ("aggregate_id")
  WHERE "aggregate_type" = 'file'
    AND "event_type" = 'file.staging_cleanup_requested';

DROP TRIGGER "trg_commission_rule_entry_append_only"
  ON public."commission_rule_entry";

ALTER TABLE public."commission_rule_entry"
  ADD COLUMN "target_name_snapshot" VARCHAR(300),
  ADD COLUMN "target_name_snapshot_source" VARCHAR(30);

UPDATE public."commission_rule_entry" e
SET
  "target_name_snapshot" = CASE e."target_type"
    WHEN 'PLATFORM' THEN '平台默认'
    WHEN 'CATEGORY' THEN (
      SELECT c."name"
      FROM public."category" c
      WHERE c."id" = e."target_id"
    )
    WHEN 'SKU' THEN (
      SELECT p."name" || ' / ' || s."code"
      FROM public."sku" s
      JOIN public."product" p ON p."id" = s."product_id"
      WHERE s."id" = e."target_id"
    )
  END,
  "target_name_snapshot_source" = 'MIGRATION_CAPTURED';

ALTER TABLE public."commission_rule_entry"
  ALTER COLUMN "target_name_snapshot" SET NOT NULL,
  ALTER COLUMN "target_name_snapshot_source" SET NOT NULL,
  ADD CONSTRAINT "chk_commission_target_name_snapshot"
    CHECK (length(btrim("target_name_snapshot")) BETWEEN 1 AND 300),
  ADD CONSTRAINT "chk_commission_target_name_snapshot_source"
    CHECK ("target_name_snapshot_source" IN ('MIGRATION_CAPTURED', 'PUBLISH_CAPTURED'));

CREATE OR REPLACE FUNCTION public.guard_commission_rule_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_status public."CommissionRuleVersionStatus";
  expected_target_name TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'commission rule entries are append-only';
  END IF;

  SELECT "status" INTO parent_status
  FROM public."commission_rule_version"
  WHERE "id" = NEW."rule_version_id";

  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'commission rule entries can be added only to a DRAFT version';
  END IF;

  IF NEW."target_name_snapshot_source" IS DISTINCT FROM 'PUBLISH_CAPTURED' THEN
    RAISE EXCEPTION 'new commission rule entries require a publish-time target name snapshot';
  END IF;

  CASE NEW."target_type"
    WHEN 'PLATFORM' THEN
      expected_target_name := '平台默认';
    WHEN 'CATEGORY' THEN
      SELECT c."name" INTO expected_target_name
      FROM public."category" c
      WHERE c."id" = NEW."target_id"
      FOR SHARE;
    WHEN 'SKU' THEN
      SELECT p."name" || ' / ' || s."code" INTO expected_target_name
      FROM public."sku" s
      JOIN public."product" p ON p."id" = s."product_id"
      WHERE s."id" = NEW."target_id"
      FOR SHARE OF s, p;
  END CASE;

  IF expected_target_name IS NULL
     OR NEW."target_name_snapshot" IS DISTINCT FROM expected_target_name THEN
    RAISE EXCEPTION 'commission rule target name snapshot does not match the publish-time target';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_commission_rule_entry_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON public."commission_rule_entry"
FOR EACH ROW EXECUTE FUNCTION public.guard_commission_rule_entry();

CREATE OR REPLACE FUNCTION public.assert_file_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  linked_file_id TEXT;
  asset_purpose TEXT;
  asset_status TEXT;
  asset_visibility TEXT;
  asset_deleted_at TIMESTAMPTZ;
BEGIN
  linked_file_id := to_jsonb(NEW) ->> TG_ARGV[1];
  IF linked_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "purpose"::TEXT, "status"::TEXT, "visibility"::TEXT, "deleted_at"
    INTO asset_purpose, asset_status, asset_visibility, asset_deleted_at
  FROM public."file_asset"
  WHERE "id" = linked_file_id
  FOR SHARE;

  IF asset_purpose IS DISTINCT FROM TG_ARGV[0]
     OR asset_status IS DISTINCT FROM 'READY'
     OR asset_deleted_at IS NOT NULL
     OR (TG_ARGV[2] <> '*' AND asset_visibility IS DISTINCT FROM TG_ARGV[2]) THEN
    RAISE EXCEPTION 'file attachment requires a READY, nondeleted asset with the expected purpose and visibility';
  END IF;

  RETURN NEW;
END $$;

COMMIT;
