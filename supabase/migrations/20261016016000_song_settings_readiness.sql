-- The legacy publication RPC can only finish the same durable, validated save intent.
-- It cannot publish an independently inserted row or silently publish a draft.
CREATE OR REPLACE FUNCTION public.publish_chart_revision(
  p_actor uuid,p_song_id uuid,p_revision_id uuid,p_expected_revision uuid,
  p_expected_version bigint,p_preview_start_ms integer
) RETURNS public.songs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.song_edit_operations; result public.songs;
BEGIN
  SELECT * INTO op FROM public.song_edit_operations WHERE id=p_revision_id;
  IF NOT FOUND OR op.owner_id<>p_actor OR op.song_id<>p_song_id OR op.kind<>'save' THEN
    RAISE EXCEPTION 'A validated song settings save intent is required' USING ERRCODE='22023';
  END IF;
  IF op.expected_version<>p_expected_version OR op.expected_revision_id IS DISTINCT FROM p_expected_revision
    OR (op.candidate->'payload'->'metadata'->>'previewStartMs')::integer IS DISTINCT FROM p_preview_start_ms THEN
    RAISE EXCEPTION 'Save request conflict' USING ERRCODE='40001';
  END IF;
  PERFORM public.commit_song_settings(p_actor,op.candidate->'payload',op.payload_hash);
  SELECT * INTO result FROM public.songs WHERE id=p_song_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_chart_revision(uuid,uuid,uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_chart_revision(uuid,uuid,uuid,uuid,bigint,integer) TO service_role;

-- Record the longest issued signed-upload capability before issuing the token.
ALTER TABLE public.song_edit_operations ADD COLUMN upload_token_expires_at timestamptz;
CREATE FUNCTION public.protect_candidate_token_lease() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.upload_token_expires_at IS NOT NULL AND
    (NEW.upload_token_expires_at>now()+interval '2 hours 5 minutes' OR
     OLD.upload_token_expires_at IS NOT NULL AND NEW.upload_token_expires_at<OLD.upload_token_expires_at) THEN
    RAISE EXCEPTION 'Invalid candidate token lease' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_candidate_token_lease() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER candidate_token_lease BEFORE UPDATE OF upload_token_expires_at ON public.song_edit_operations
FOR EACH ROW EXECUTE FUNCTION public.protect_candidate_token_lease();

-- A cheap readiness check is required as well as the operator gate. Missing any
-- later migration, immutable-storage trigger or service boundary fails closed.
CREATE FUNCTION public.song_settings_schema_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT
  pg_catalog.to_regprocedure('public.can_reclaim_image_object(text)') IS NOT NULL AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.image_assets'::regclass AND tgname='verified_image_identity' AND tgenabled<>'D') AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.song_edit_operations'::regclass AND tgname='song_source_operation_quota' AND tgenabled<>'D') AND
  pg_catalog.to_regprocedure('public.commit_song_settings(uuid,jsonb,text)') IS NOT NULL AND
  pg_catalog.to_regprocedure('public.begin_song_settings_save(uuid,jsonb,text)') IS NOT NULL AND
  pg_catalog.to_regprocedure('public.begin_song_settings_source(uuid,uuid,uuid,text,uuid,text,uuid,text)') IS NOT NULL AND
  pg_catalog.to_regprocedure('public.claim_song_asset_cleanup(uuid,integer)') IS NOT NULL AND
  pg_catalog.to_regprocedure('public.finish_song_asset_cleanup(uuid,uuid,text)') IS NOT NULL AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.song_edit_operations'::regclass AND attname='upload_token_expires_at' AND NOT attisdropped) AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.song_edit_objects'::regclass AND attname='max_bytes' AND NOT attisdropped) AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='private_candidate_upload_limit' AND tgenabled<>'D') AND
  EXISTS(SELECT 1 FROM storage.buckets WHERE id='songs') AND
  (SELECT count(*)=3 AND bool_and(NOT public) FROM storage.buckets WHERE id IN ('asset-staging','profile-card-images','chart-revision-assets')) AND
  NOT pg_catalog.has_function_privilege('authenticated','public.commit_song_settings(uuid,jsonb,text)','EXECUTE') AND
  NOT pg_catalog.has_function_privilege('anon','public.commit_song_settings(uuid,jsonb,text)','EXECUTE') AND
  NOT pg_catalog.has_function_privilege('authenticated','public.begin_song_settings_source(uuid,uuid,uuid,text,uuid,text,uuid,text)','EXECUTE')
$$;
REVOKE ALL ON FUNCTION public.song_settings_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.song_settings_schema_ready() TO service_role;
