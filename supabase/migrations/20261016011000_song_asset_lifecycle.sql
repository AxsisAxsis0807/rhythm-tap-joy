-- Exact-object manifests are written before Storage uploads, including crash boundaries.
CREATE TABLE public.song_edit_objects (
  bucket_id text NOT NULL CHECK (bucket_id='chart-revision-assets'),
  path text NOT NULL UNIQUE,
  operation_id uuid NOT NULL REFERENCES public.song_edit_operations(id),
  PRIMARY KEY(bucket_id,path)
);
ALTER TABLE public.song_edit_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_edit_objects FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.song_edit_objects TO service_role;
ALTER TABLE public.asset_cleanup_jobs DROP CONSTRAINT asset_cleanup_jobs_bucket_id_check;
ALTER TABLE public.asset_cleanup_jobs ADD CONSTRAINT asset_cleanup_jobs_bucket_id_check CHECK (bucket_id IN ('asset-staging','profile-card-images','chart-revision-assets','songs'));
ALTER TABLE public.asset_cleanup_jobs ADD COLUMN operation_id uuid REFERENCES public.song_edit_operations(id);
CREATE TABLE public.revision_gc_markers (
  path text PRIMARY KEY REFERENCES public.song_edit_objects(path),
  operation_id uuid NOT NULL REFERENCES public.song_edit_operations(id),
  lease_owner uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.revision_gc_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revision_gc_markers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.revision_gc_markers TO service_role;

CREATE OR REPLACE FUNCTION public.protect_canonical_storage() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.bucket_id='chart-revision-assets' THEN
    IF TG_OP='DELETE' AND current_user IN ('service_role','supabase_storage_admin') AND EXISTS(
      SELECT 1 FROM public.revision_gc_markers g JOIN public.song_edit_operations o ON o.id=g.operation_id
      JOIN public.song_edit_objects f ON f.operation_id=o.id AND f.path=g.path
      WHERE g.path=OLD.name AND g.expires_at>now() AND o.kind<>'save' AND o.state IN ('abandoned','expired','failed')
        AND NOT EXISTS(SELECT 1 FROM public.chart_revisions r WHERE r.chart_path=OLD.name OR r.audio_path=OLD.name)
    ) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Canonical revision bytes are immutable' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_canonical_storage() FROM PUBLIC,anon,authenticated;
-- Actual Storage's DB role may differ: preflight and real-role tests are required before enabling GC.
GRANT SELECT ON public.revision_gc_markers,public.song_edit_objects,public.song_edit_operations,public.chart_revisions TO service_role;

CREATE FUNCTION public.reserve_song_background(p_actor uuid,p_song_id uuid,p_id uuid,p_mime_type text,p_expected_bytes integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reservation public.image_reservations; previous_subject text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.song_settings_gates WHERE singleton AND settings_enabled AND background_enabled) THEN
    RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.songs WHERE id=p_song_id AND user_id=p_actor) THEN
    RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  previous_subject := current_setting('request.jwt.claim.sub',true);
  PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
  SELECT * INTO reservation FROM public.reserve_image_asset(p_id,'chart-background',p_song_id,p_mime_type,p_expected_bytes);
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
  IF reservation.state<>'reserved' OR reservation.expires_at<=now() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED' USING ERRCODE='22023'; END IF;
  -- Token issuance can fail after this transaction; retaining a longer grace is harmless.
  UPDATE public.image_reservations SET upload_token_expires_at=greatest(coalesce(upload_token_expires_at,now()),now()+interval '2 hours') WHERE id=p_id RETURNING * INTO reservation;
  UPDATE public.asset_cleanup_jobs SET not_before=greatest(not_before,reservation.upload_token_expires_at+interval '1 hour') WHERE bucket_id='asset-staging' AND path=reservation.path;
  RETURN to_jsonb(reservation);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_song_background(uuid,uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_song_background(uuid,uuid,uuid,text,integer) TO service_role;

