CREATE FUNCTION public.can_reclaim_image_object(p_path text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
SELECT EXISTS(
 SELECT 1 FROM public.asset_cleanup_jobs j
 LEFT JOIN public.image_assets a ON a.path=j.path
 WHERE j.bucket_id='profile-card-images' AND j.path=p_path AND j.delete_started_at IS NOT NULL
 AND j.lease_expires_at>now() AND j.locked_by IS NOT NULL AND j.completed_at IS NULL AND j.dead_letter_at IS NULL
 AND (a.id IS NOT NULL AND a.deleting AND a.deleted_at IS NULL OR
   a.id IS NULL AND EXISTS(SELECT 1 FROM public.image_reservations r WHERE r.owner_id::text||'/'||r.id::text||'/master'=j.path AND r.purpose='chart-background' AND r.expires_at<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.songs s WHERE s.background_asset_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM public.profile_preferences p WHERE p.background_asset_id=a.id)
)
$$;
REVOKE ALL ON FUNCTION public.can_reclaim_image_object(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_reclaim_image_object(text) TO service_role;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN
 GRANT EXECUTE ON FUNCTION public.can_reclaim_image_object(text) TO supabase_storage_admin;
END IF; END$$;
CREATE OR REPLACE FUNCTION public.protect_canonical_storage() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.bucket_id='chart-revision-assets' THEN
  IF TG_OP='DELETE' AND current_user IN ('service_role','supabase_storage_admin') AND public.can_reclaim_revision_object(OLD.name) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Canonical revision bytes are immutable' USING ERRCODE='42501';
 ELSIF OLD.bucket_id='profile-card-images' THEN
  IF TG_OP='DELETE' AND current_user IN ('service_role','supabase_storage_admin') AND public.can_reclaim_image_object(OLD.name) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Canonical image bytes are immutable' USING ERRCODE='42501';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_canonical_storage() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.protect_verified_image() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE started timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT delete_started_at INTO started FROM public.asset_cleanup_jobs WHERE bucket_id='profile-card-images' AND path=NEW.path FOR SHARE;
  IF started IS NOT NULL THEN RAISE EXCEPTION 'Image reclamation already started' USING ERRCODE='42501'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.owner_id,NEW.purpose,NEW.target_id,NEW.path,NEW.content_hash,NEW.mime_type,NEW.width,NEW.height,NEW.byte_size,NEW.verified_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.purpose,OLD.target_id,OLD.path,OLD.content_hash,OLD.mime_type,OLD.width,OLD.height,OLD.byte_size,OLD.verified_at)
    OR OLD.deleting AND NOT NEW.deleting OR OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
   RAISE EXCEPTION 'Verified image identity is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_verified_image() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER verified_image_identity BEFORE INSERT OR UPDATE ON public.image_assets FOR EACH ROW EXECUTE FUNCTION public.protect_verified_image();
CREATE OR REPLACE FUNCTION public.limit_private_candidate_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ceiling integer;
BEGIN
 IF NEW.bucket_id='chart-revision-assets' THEN
  SELECT max_bytes INTO ceiling FROM public.song_edit_objects WHERE path=NEW.name;
 ELSIF NEW.bucket_id='asset-staging' THEN
  SELECT expected_bytes INTO ceiling FROM public.image_reservations WHERE path=NEW.name;
 END IF;
 -- Storage's permission probe INSERT is rolled back and carries no real size.
 -- Enforce the declared size when Storage supplies completed upload metadata.
 IF ceiling IS NOT NULL AND coalesce((NEW.metadata->>'size')::bigint,0)>0 AND (NEW.metadata->>'size')::bigint<>ceiling THEN
  RAISE EXCEPTION 'Upload differs from its reserved byte size' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.limit_private_candidate_upload() FROM PUBLIC,anon,authenticated;

DROP TRIGGER private_candidate_upload_limit ON storage.objects;
CREATE TRIGGER private_candidate_upload_limit BEFORE INSERT OR UPDATE OF metadata ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.limit_private_candidate_upload();
