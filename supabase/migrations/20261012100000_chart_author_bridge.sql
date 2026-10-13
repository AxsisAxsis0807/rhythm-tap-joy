-- Supabase is the schema source of truth from this migration onward.
-- Retain Drizzle 0000 in history; do not run that one-time migration again.
DO $$
DECLARE column_info record;
BEGIN
  SELECT a.atttypid, a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
  INTO column_info
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.songs'::regclass AND a.attname = 'chart_author' AND NOT a.attisdropped;
  IF NOT FOUND THEN
    ALTER TABLE public.songs ADD COLUMN chart_author text NOT NULL DEFAULT '';
  ELSIF column_info.atttypid <> 'text'::regtype OR NOT column_info.attnotnull
    OR column_info.default_expr IS DISTINCT FROM '''''::text' THEN
    RAISE EXCEPTION 'chart_author conflicts with the Drizzle bridge contract; inspect type/nullability/default before continuing';
  END IF;
END;
$$;
COMMENT ON COLUMN public.songs.chart_author IS 'Chart creator. Drizzle 0000 bridged; future schema changes use Supabase migrations.';
