ALTER TABLE public.song_edit_operations ADD COLUMN worker_id uuid,ADD COLUMN lease_expires_at timestamptz;
CREATE FUNCTION public.begin_song_settings_source(p_actor uuid,p_id uuid,p_song_id uuid,p_version text,p_revision uuid,p_hash text,p_worker uuid,p_kind text DEFAULT 'source')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE song public.songs; op public.song_edit_operations;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.song_settings_gates WHERE singleton AND settings_enabled AND timing_enabled) THEN RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000'; END IF;
  IF p_version !~ '^(0|[1-9][0-9]*)$' OR p_kind NOT IN ('source','replacement') OR p_worker IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,160100));
  SELECT * INTO song FROM public.songs WHERE id=p_song_id FOR UPDATE;
  IF NOT FOUND OR song.user_id<>p_actor THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF song.metadata_version<>p_version::bigint OR song.current_revision_id IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE='40001'; END IF;
  SELECT * INTO op FROM public.song_edit_operations WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF op.owner_id<>p_actor OR op.song_id<>p_song_id THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF op.payload_hash<>p_hash OR op.kind<>p_kind THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
    IF op.expires_at<=now() OR op.state IN ('committed','abandoned','expired') THEN RAISE EXCEPTION 'SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
    IF op.state='prepared' THEN RETURN to_jsonb(op)||jsonb_build_object('expected_version',op.expected_version::text); END IF;
    IF op.state='preparing' AND op.lease_expires_at>now() THEN RAISE EXCEPTION 'OPERATION_BUSY' USING ERRCODE='55000'; END IF;
    UPDATE public.song_edit_operations SET state='preparing',worker_id=p_worker,lease_expires_at=now()+interval '5 minutes',updated_at=now(),error_code=NULL WHERE id=p_id RETURNING * INTO op;
  ELSE
    INSERT INTO public.song_edit_operations(id,owner_id,song_id,kind,payload_hash,expected_version,expected_revision_id,worker_id,lease_expires_at)
      VALUES(p_id,p_actor,p_song_id,p_kind,p_hash,p_version::bigint,p_revision,p_worker,now()+interval '5 minutes') RETURNING * INTO op;
  END IF;
  RETURN to_jsonb(op)||jsonb_build_object('expected_version',op.expected_version::text);
END;
$$;
REVOKE ALL ON FUNCTION public.begin_song_settings_source(uuid,uuid,uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_song_settings_source(uuid,uuid,uuid,text,uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.get_owner_song_operation(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.song_edit_operations;
BEGIN
  SELECT * INTO op FROM public.song_edit_operations WHERE id=p_id AND owner_id=p_actor;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(op)||jsonb_build_object('expected_version',op.expected_version::text);
END;
$$;
REVOKE ALL ON FUNCTION public.get_owner_song_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_song_operation(uuid,uuid) TO service_role;
CREATE FUNCTION public.abandon_song_settings_operation(p_actor uuid,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.song_edit_operations SET state='abandoned',updated_at=now(),worker_id=NULL,lease_expires_at=NULL
    WHERE id=p_id AND owner_id=p_actor AND kind<>'save' AND state IN ('preparing','prepared','failed');
END;
$$;
REVOKE ALL ON FUNCTION public.abandon_song_settings_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_song_settings_operation(uuid,uuid) TO service_role;
