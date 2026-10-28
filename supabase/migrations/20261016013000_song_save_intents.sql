CREATE FUNCTION public.begin_song_settings_save(p_actor uuid,p_payload jsonb,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.song_edit_operations; song public.songs; request_id uuid; target_id uuid;
BEGIN
  request_id:=(p_payload->>'requestId')::uuid;target_id:=(p_payload->>'songId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text,160100));
  SELECT * INTO op FROM public.song_edit_operations WHERE id=request_id FOR UPDATE;
  IF FOUND THEN
    IF op.owner_id<>p_actor OR op.song_id<>target_id THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF op.kind<>'save' OR op.payload_hash<>p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.song_settings_gates WHERE singleton AND settings_enabled) THEN RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000'; END IF;
  SELECT * INTO song FROM public.songs WHERE id=target_id FOR UPDATE;
  IF NOT FOUND OR song.user_id<>p_actor THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF song.metadata_version<>(p_payload->>'expectedVersion')::bigint OR song.current_revision_id IS DISTINCT FROM (p_payload->>'expectedRevisionId')::uuid THEN RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE='40001'; END IF;
  INSERT INTO public.song_edit_operations(id,owner_id,song_id,kind,payload_hash,expected_version,expected_revision_id,candidate)
    VALUES(request_id,p_actor,target_id,'save',p_hash,(p_payload->>'expectedVersion')::bigint,(p_payload->>'expectedRevisionId')::uuid,jsonb_build_object('payload',p_payload));
END;
$$;
REVOKE ALL ON FUNCTION public.begin_song_settings_save(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_song_settings_save(uuid,jsonb,text) TO service_role;
