ALTER TABLE public.asset_cleanup_jobs ADD COLUMN delete_started_at timestamptz;
CREATE FUNCTION public.can_reclaim_revision_object(p_path text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.revision_gc_markers g JOIN public.song_edit_operations o ON o.id=g.operation_id
    JOIN public.song_edit_objects f ON f.operation_id=o.id AND f.path=g.path
    WHERE g.path=p_path AND g.expires_at>now() AND o.kind<>'save' AND o.state IN ('abandoned','expired','failed')
    AND NOT EXISTS(SELECT 1 FROM public.chart_revisions r WHERE r.chart_path=p_path OR r.audio_path=p_path))
$$;
REVOKE ALL ON FUNCTION public.can_reclaim_revision_object(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_reclaim_revision_object(text) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN
  GRANT EXECUTE ON FUNCTION public.can_reclaim_revision_object(text) TO supabase_storage_admin;
END IF; END $$;
CREATE OR REPLACE FUNCTION public.protect_canonical_storage() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.bucket_id='chart-revision-assets' THEN
    IF TG_OP='DELETE' AND current_user IN ('service_role','supabase_storage_admin') AND public.can_reclaim_revision_object(OLD.name) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Canonical revision bytes are immutable' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_canonical_storage() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.decode_legacy_asset_url(p_url text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE value bytea:=''::bytea; pos integer:=1; character text;
BEGIN
  WHILE pos<=length(p_url) LOOP
    character:=substr(p_url,pos,1);
    IF character='%' THEN
      IF substr(p_url,pos+1,2) !~ '^[a-fA-F0-9]{2}$' THEN RETURN NULL; END IF;
      value:=value||decode(substr(p_url,pos+1,2),'hex');pos:=pos+3;
    ELSE value:=value||convert_to(character,'UTF8');pos:=pos+1;
    END IF;
  END LOOP;
  RETURN convert_from(value,'UTF8');
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.decode_legacy_asset_url(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.protect_legacy_asset_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_path text; field text; previous text; job public.asset_cleanup_jobs;
BEGIN
  IF TG_TABLE_NAME='profiles' THEN
    IF NEW.avatar_url IS NULL OR (TG_OP='UPDATE' AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url) THEN RETURN NEW; END IF;
    FOR job IN SELECT * FROM public.asset_cleanup_jobs j WHERE j.bucket_id='songs' AND position('/songs/'||j.path IN public.decode_legacy_asset_url(NEW.avatar_url))>0 ORDER BY id FOR SHARE LOOP
      IF job.delete_started_at IS NOT NULL THEN RAISE EXCEPTION 'Legacy asset is being reclaimed; use a fresh path' USING ERRCODE='42501'; END IF;
    END LOOP;
  ELSE
    FOREACH field IN ARRAY ARRAY['background_path','cover_path','player_image_path','opponent_image_path','audio_path','chart_path'] LOOP
      v_path:=to_jsonb(NEW)->>field;previous:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)->>field ELSE NULL END;
      IF v_path IS NULL OR v_path IS NOT DISTINCT FROM previous THEN CONTINUE; END IF;
      SELECT * INTO job FROM public.asset_cleanup_jobs j WHERE j.bucket_id='songs' AND j.path=v_path FOR SHARE;
      IF FOUND AND job.delete_started_at IS NOT NULL THEN RAISE EXCEPTION 'Legacy asset is being reclaimed; use a fresh path' USING ERRCODE='42501'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_legacy_asset_references() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER songs_legacy_asset_references BEFORE INSERT OR UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.protect_legacy_asset_references();
CREATE TRIGGER profiles_legacy_asset_references BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_legacy_asset_references();

-- Returns only pre-existing allowlisted jobs. Cleanup never accepts a client bucket/path.
-- Claim locks: job -> operation OR asset. Save locks song -> operation -> asset; cleanup never locks a song.
CREATE FUNCTION public.claim_song_asset_cleanup(p_worker uuid,p_limit integer DEFAULT 8)
RETURNS SETOF public.asset_cleanup_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.asset_cleanup_jobs; asset public.image_assets; operation public.song_edit_operations; reservation public.image_reservations;
BEGIN
  IF p_worker IS NULL OR p_limit NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  FOR job IN SELECT * FROM public.asset_cleanup_jobs WHERE completed_at IS NULL AND dead_letter_at IS NULL AND not_before<=now() AND next_attempt_at<=now()
    AND (lease_expires_at IS NULL OR lease_expires_at<=now()) ORDER BY not_before,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
    IF job.bucket_id='profile-card-images' THEN
      SELECT * INTO asset FROM public.image_assets WHERE path=job.path FOR UPDATE;
      IF FOUND THEN
        IF EXISTS(SELECT 1 FROM public.songs WHERE background_asset_id=asset.id) OR
          EXISTS(SELECT 1 FROM public.profile_preferences WHERE background_asset_id=asset.id) OR
          EXISTS(SELECT 1 FROM public.song_edit_operations WHERE state IN ('preparing','prepared') AND expires_at>now() AND (candidate->>'background_asset_id'=asset.id::text OR candidate->'payload'->'background'->>'assetId'=asset.id::text)) THEN
          UPDATE public.asset_cleanup_jobs SET next_attempt_at=now()+interval '24 hours' WHERE id=job.id;
          CONTINUE;
        END IF;
        UPDATE public.image_assets SET deleting=true WHERE id=asset.id;
      ELSIF NOT EXISTS(SELECT 1 FROM public.image_reservations r WHERE r.owner_id::text||'/'||r.id::text||'/master'=job.path AND r.purpose='chart-background') THEN
        UPDATE public.asset_cleanup_jobs SET dead_letter_at=now(),last_error='UNKNOWN_CANONICAL_PATH' WHERE id=job.id;
        CONTINUE;
      END IF;
    ELSIF job.bucket_id='asset-staging' THEN
      SELECT * INTO reservation FROM public.image_reservations WHERE path=job.path FOR UPDATE;
      IF NOT FOUND OR reservation.expires_at>now() OR coalesce(reservation.upload_token_expires_at,reservation.created_at+interval '2 hours')>now() THEN
        UPDATE public.asset_cleanup_jobs SET next_attempt_at=now()+interval '1 hour' WHERE id=job.id;
        CONTINUE;
      END IF;
    ELSIF job.bucket_id='chart-revision-assets' THEN
      SELECT * INTO operation FROM public.song_edit_operations WHERE id=job.operation_id FOR UPDATE;
      IF NOT FOUND OR operation.kind='save' OR operation.expires_at>now() OR
        (to_jsonb(operation)->>'upload_token_expires_at')::timestamptz>now() OR
        NOT EXISTS(SELECT 1 FROM public.song_edit_objects f WHERE f.path=job.path AND f.operation_id=operation.id) THEN
        UPDATE public.asset_cleanup_jobs SET next_attempt_at=now()+interval '1 hour' WHERE id=job.id;
        CONTINUE;
      END IF;
      IF EXISTS(SELECT 1 FROM public.chart_revisions WHERE chart_path=job.path OR audio_path=job.path) THEN
        UPDATE public.asset_cleanup_jobs SET completed_at=now() WHERE id=job.id;
        CONTINUE;
      END IF;
      UPDATE public.song_edit_operations SET state='expired',updated_at=now() WHERE id=operation.id;
      INSERT INTO public.revision_gc_markers(path,operation_id,lease_owner,expires_at) VALUES(job.path,operation.id,p_worker,now()+interval '5 minutes')
        ON CONFLICT(path) DO UPDATE SET lease_owner=p_worker,expires_at=excluded.expires_at;
    ELSE
      IF job.path !~ '^[a-f0-9-]{36}/[^?#\\]+$' OR job.path ~ '(^|/)\.\.?(/|$)' OR
        NOT EXISTS(SELECT 1 FROM auth.users WHERE id::text=split_part(job.path,'/',1)) THEN
        UPDATE public.asset_cleanup_jobs SET dead_letter_at=now(),last_error='INVALID_LEGACY_PATH' WHERE id=job.id;
        CONTINUE;
      END IF;
      IF EXISTS(SELECT 1 FROM public.songs s WHERE job.path IN (s.background_path,s.cover_path,s.player_image_path,s.opponent_image_path,s.audio_path,s.chart_path)) OR
        EXISTS(SELECT 1 FROM public.profiles p WHERE p.avatar_url IS NOT NULL AND
          (public.decode_legacy_asset_url(p.avatar_url) IS NULL OR position('/songs/'||job.path IN public.decode_legacy_asset_url(p.avatar_url))>0)) THEN
        UPDATE public.asset_cleanup_jobs SET next_attempt_at=now()+interval '24 hours' WHERE id=job.id;
        CONTINUE;
      END IF;
    END IF;
    UPDATE public.asset_cleanup_jobs SET locked_by=p_worker,lease_expires_at=now()+interval '5 minutes',attempts=attempts+1,delete_started_at=coalesce(delete_started_at,now()) WHERE id=job.id RETURNING * INTO job;
    RETURN NEXT job;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_song_asset_cleanup(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_song_asset_cleanup(uuid,integer) TO service_role;
CREATE FUNCTION public.finish_song_asset_cleanup(p_worker uuid,p_job uuid,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.asset_cleanup_jobs;
BEGIN
  SELECT * INTO job FROM public.asset_cleanup_jobs WHERE id=p_job AND locked_by=p_worker AND lease_expires_at>now() AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_error IS NULL THEN
    IF job.bucket_id='profile-card-images' THEN UPDATE public.image_assets SET deleted_at=now(),deleting=true WHERE path=job.path; END IF;
    UPDATE public.asset_cleanup_jobs SET completed_at=now(),locked_by=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=p_job;
    IF job.bucket_id='chart-revision-assets' THEN DELETE FROM public.revision_gc_markers WHERE path=job.path AND lease_owner=p_worker; END IF;
  ELSE
    UPDATE public.asset_cleanup_jobs SET last_error=left(p_error,100),next_attempt_at=now()+make_interval(secs=>least(86400,60*power(2,least(attempts,10))::integer)),
      dead_letter_at=CASE WHEN attempts>=5 THEN now() ELSE NULL END,locked_by=NULL,lease_expires_at=NULL WHERE id=p_job;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_song_asset_cleanup(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_song_asset_cleanup(uuid,uuid,text) TO service_role;
