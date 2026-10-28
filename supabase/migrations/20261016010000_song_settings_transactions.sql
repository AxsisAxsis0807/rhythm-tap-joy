-- Expand-only, write gates default OFF. Registered revisions and result history are untouched.
ALTER TABLE public.songs ADD COLUMN background_asset_id uuid REFERENCES public.image_assets(id);
ALTER TABLE public.chart_revisions
  ADD COLUMN source_format text NOT NULL DEFAULT 'unknown' CHECK (source_format IN ('native','osu','fnf-legacy','fnf-vslice','unknown')),
  ADD COLUMN timing_basis text NOT NULL DEFAULT 'unknown' CHECK (timing_basis IN ('beats','absolute-seconds','unknown'));
ALTER TABLE public.image_assets ADD COLUMN deleting boolean NOT NULL DEFAULT false, ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.image_reservations ADD COLUMN upload_token_expires_at timestamptz;
ALTER TABLE public.asset_cleanup_jobs
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_expires_at timestamptz, ADD COLUMN locked_by uuid,
  ADD COLUMN dead_letter_at timestamptz;
CREATE TABLE public.song_settings_gates (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  settings_enabled boolean NOT NULL DEFAULT false,
  background_enabled boolean NOT NULL DEFAULT false,
  timing_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.song_settings_gates DEFAULT VALUES;
ALTER TABLE public.song_settings_gates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_settings_gates FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.song_settings_gates TO service_role;
CREATE TABLE public.song_edit_operations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  song_id uuid NOT NULL REFERENCES public.songs(id),
  kind text NOT NULL CHECK (kind IN ('source','replacement','save')),
  state text NOT NULL DEFAULT 'preparing' CHECK (state IN ('preparing','prepared','committed','abandoned','expired','failed')),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  expected_revision_id uuid,
  candidate jsonb,
  receipt jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  CHECK ((kind = 'save' AND state = 'committed') = (receipt IS NOT NULL)),
  CHECK (state <> 'prepared' OR (kind <> 'save' AND candidate IS NOT NULL))
);
CREATE INDEX song_edit_operations_expiry ON public.song_edit_operations(expires_at) WHERE state IN ('preparing','prepared');
ALTER TABLE public.song_edit_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_edit_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.song_edit_operations TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.song_edit_operations TO service_role;
CREATE POLICY "Owner operation receipts" ON public.song_edit_operations FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE FUNCTION public.song_settings_projection(p_song public.songs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_jsonb(p_song) || jsonb_build_object('metadata_version',p_song.metadata_version::text) ||
    CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('fnf_side',r.fnf_side,'chart_type',CASE WHEN r.fnf_side IS NULL THEN 'mania' ELSE 'fnf' END) END
  FROM (SELECT 1) anchor LEFT JOIN public.chart_revisions r ON r.id=p_song.current_revision_id
$$;
REVOKE ALL ON FUNCTION public.song_settings_projection(public.songs) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.song_settings_projection(public.songs) TO service_role;

CREATE FUNCTION public.validate_song_metadata(p_song public.songs,p_metadata jsonb,p_duration integer)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE k text; lim integer; val text; oldval text; start_ms integer;
BEGIN
  IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR
    p_metadata - ARRAY['title','artist','chartAuthor','difficultyName','description','recommendedPlayStyle','previewStartMs'] <> '{}'::jsonb OR
    NOT p_metadata ?& ARRAY['title','artist','chartAuthor','difficultyName','description','recommendedPlayStyle','previewStartMs'] THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['title','artist','chartAuthor','difficultyName','description'] LOOP
    val := p_metadata->>k;
    oldval := CASE k WHEN 'chartAuthor' THEN p_song.chart_author WHEN 'difficultyName' THEN p_song.difficulty_name ELSE to_jsonb(p_song)->>k END;
    lim := CASE k WHEN 'difficultyName' THEN 40 WHEN 'description' THEN 2000 ELSE 120 END;
    IF (k <> 'description' AND val IS NULL) OR
      (val IS DISTINCT FROM oldval AND (length(coalesce(val,'')) > lim OR (k='title' AND length(btrim(val)) < 1))) OR
      (jsonb_typeof(p_metadata->k) <> 'string' AND NOT (k='description' AND p_metadata->k='null'::jsonb)) THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_metadata->>'recommendedPlayStyle' IS NOT NULL AND p_metadata->>'recommendedPlayStyle' NOT IN ('mania','fnf') THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  IF p_metadata->>'previewStartMs' IS NOT NULL THEN
    IF (p_metadata->>'previewStartMs') !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    start_ms := (p_metadata->>'previewStartMs')::integer;
    IF start_ms < 0 OR (p_duration IS NULL AND start_ms <> 0 AND start_ms IS DISTINCT FROM p_song.preview_start_ms) OR start_ms >= p_duration THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_song_metadata(public.songs,jsonb,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.update_chart_metadata(
  p_song_id uuid,p_expected_version bigint,p_expected_revision uuid,p_title text,p_artist text,p_chart_author text,
  p_difficulty_name text,p_description text,p_recommended_play_style text,p_preview_start_ms integer
) RETURNS public.songs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE song public.songs; duration integer; m jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO song FROM public.songs WHERE id=p_song_id FOR UPDATE;
  IF NOT FOUND OR song.user_id <> auth.uid() THEN RAISE EXCEPTION 'Song owner required' USING ERRCODE='42501'; END IF;
  IF song.metadata_version <> p_expected_version OR song.current_revision_id IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'This song changed; reload before saving' USING ERRCODE='40001';
  END IF;
  SELECT duration_ms INTO duration FROM public.chart_revisions WHERE id=song.current_revision_id;
  m := jsonb_build_object('title',p_title,'artist',p_artist,'chartAuthor',p_chart_author,'difficultyName',p_difficulty_name,
    'description',p_description,'recommendedPlayStyle',p_recommended_play_style,'previewStartMs',p_preview_start_ms);
  PERFORM public.validate_song_metadata(song,m,duration);
  IF ROW(song.title,song.artist,song.chart_author,song.difficulty_name,song.description,song.recommended_play_style,song.preview_start_ms)
    IS DISTINCT FROM ROW(p_title,p_artist,p_chart_author,p_difficulty_name,p_description,p_recommended_play_style,p_preview_start_ms) THEN
    UPDATE public.songs SET title=p_title,artist=p_artist,chart_author=p_chart_author,difficulty_name=p_difficulty_name,
      description=p_description,recommended_play_style=p_recommended_play_style,preview_start_ms=p_preview_start_ms,
      metadata_version=metadata_version+1 WHERE id=p_song_id RETURNING * INTO song;
  END IF;
  RETURN song;
END;
$$;
-- Existing explicit grants survive CREATE OR REPLACE; restate the boundary for auditing.
REVOKE ALL ON FUNCTION public.update_chart_metadata(uuid,bigint,uuid,text,text,text,text,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_chart_metadata(uuid,bigint,uuid,text,text,text,text,text,text,integer) TO authenticated;

CREATE FUNCTION public.get_song_settings(p_song_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE song public.songs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO song FROM public.songs WHERE id=p_song_id AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN public.song_settings_projection(song);
END;
$$;
REVOKE ALL ON FUNCTION public.get_song_settings(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_song_settings(uuid) TO authenticated;

-- Protect the new pointer at INSERT as well as UPDATE, including old REST clients.
CREATE FUNCTION public.protect_song_background() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND
    ((TG_OP='INSERT' AND NEW.background_asset_id IS NOT NULL) OR
     (TG_OP='UPDATE' AND NEW.background_asset_id IS DISTINCT FROM OLD.background_asset_id)) THEN
    RAISE EXCEPTION 'Server managed background' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_song_background() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER songs_protect_background BEFORE INSERT OR UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.protect_song_background();

-- A save intent has its own immutable candidate; two intents never overwrite one source handle.
CREATE TABLE public.song_revision_candidates (
  request_id uuid PRIMARY KEY,
  source_operation_id uuid NOT NULL REFERENCES public.song_edit_operations(id),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  candidate jsonb NOT NULL
);
ALTER TABLE public.song_revision_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_revision_candidates FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.song_revision_candidates TO service_role;

-- Lock order: save request -> song -> source operation -> image asset(s, ascending UUID).
-- Storage is always prepared outside this transaction. No HTTP is called under row locks.
CREATE FUNCTION public.commit_song_settings(p_actor uuid,p_payload jsonb,p_payload_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  song public.songs; op public.song_edit_operations; source public.song_edit_operations;
  asset public.image_assets; old_asset public.image_assets; gates public.song_settings_gates;
  v_request_id uuid; v_song_id uuid; source_id uuid; revision_id uuid; revision public.chart_revisions;
  m jsonb; c jsonb; receipt jsonb; duration integer; number integer;
  background_action text; gameplay_action text; next_background uuid; next_path text;
BEGIN
  -- EXECUTE grants are the first boundary; a security-definer owner is not the JWT role.
  IF p_actor IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  v_request_id := (p_payload->>'requestId')::uuid; v_song_id := (p_payload->>'songId')::uuid;
  IF v_request_id IS NULL OR v_song_id IS NULL OR p_payload->>'expectedVersion' !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  -- Serialize both first insert and retries; hashed advisory locks are scoped by this namespace.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_request_id::text,160100));
  SELECT * INTO op FROM public.song_edit_operations WHERE id=v_request_id FOR UPDATE;
  IF FOUND THEN
    IF op.owner_id<>p_actor OR op.song_id<>v_song_id THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF op.kind<>'save' OR op.payload_hash<>p_payload_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
    IF op.state='committed' THEN RETURN op.receipt; END IF;
    IF op.state NOT IN ('preparing','failed') THEN RAISE EXCEPTION 'OPERATION_NOT_READY' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO gates FROM public.song_settings_gates WHERE singleton;
  IF NOT coalesce(gates.settings_enabled,false) THEN RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000'; END IF;
  SELECT * INTO song FROM public.songs WHERE id=v_song_id FOR UPDATE;
  IF NOT FOUND OR song.user_id<>p_actor THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF song.metadata_version<>(p_payload->>'expectedVersion')::bigint OR song.current_revision_id IS DISTINCT FROM (p_payload->>'expectedRevisionId')::uuid THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE='40001';
  END IF;
  m := p_payload->'metadata'; background_action := p_payload->'background'->>'action'; gameplay_action := p_payload->'gameplay'->>'action';
  IF background_action IS NULL OR background_action NOT IN ('keep','remove','replace') OR gameplay_action IS NULL OR gameplay_action NOT IN ('keep','timing','prepared-replacement') THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  source_id := coalesce((p_payload->'gameplay'->>'sourceOperationId')::uuid,(p_payload->>'sourceOperationId')::uuid);
  IF source_id IS NOT NULL THEN
    IF NOT gates.timing_enabled THEN RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000'; END IF;
    SELECT * INTO source FROM public.song_edit_operations WHERE id=source_id FOR UPDATE;
    IF NOT FOUND OR source.owner_id<>p_actor OR source.song_id<>v_song_id THEN RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF source.kind NOT IN ('source','replacement') OR source.state<>'prepared' OR source.expires_at<=now() OR
      source.expected_version<>song.metadata_version OR source.expected_revision_id IS DISTINCT FROM song.current_revision_id THEN
      RAISE EXCEPTION 'SOURCE_CHANGED' USING ERRCODE='40001';
    END IF;
    IF p_payload->'rightsConfirmation'->>'confirmed' IS DISTINCT FROM 'true' OR (p_payload->'rightsConfirmation'->>'sourceOperationId')::uuid IS DISTINCT FROM source_id THEN
      RAISE EXCEPTION 'RIGHTS_REQUIRED' USING ERRCODE='22023';
    END IF;
    SELECT rc.candidate INTO c FROM public.song_revision_candidates rc WHERE rc.request_id=v_request_id AND rc.source_operation_id=source_id AND rc.payload_hash=p_payload_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASSET_NOT_READY' USING ERRCODE='22023'; END IF;
    -- Server prepares the final immutable paths under requestId before entering this RPC.
    IF c->>'request_id' IS DISTINCT FROM v_request_id::text OR c->>'chart_path' IS DISTINCT FROM v_song_id::text||'/'||v_request_id::text||'/chart.json' OR
      c->>'audio_path' IS DISTINCT FROM v_song_id::text||'/'||v_request_id::text||'/audio' OR c->>'validated' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'ASSET_NOT_READY' USING ERRCODE='22023';
    END IF;
    duration := (c->>'duration_ms')::integer;
    SELECT coalesce(max(revision_number),0)+1 INTO number FROM public.chart_revisions WHERE chart_key=v_song_id::text;
    INSERT INTO public.chart_revisions(id,song_id,chart_key,revision_number,chart_path,audio_path,chart_hash,audio_hash,parser_version,
      duration_ms,note_count,lane_count,fnf_side,rights_confirmed_by,preview_allowed,source_format,timing_basis)
    VALUES(v_request_id,v_song_id,v_song_id::text,number,c->>'chart_path',c->>'audio_path',c->>'chart_hash',c->>'audio_hash','pulse-chart-v1',
      duration,(c->>'note_count')::integer,4,c->>'fnf_side',p_actor,(c->>'preview_allowed')::boolean,c->>'source_format',c->>'timing_basis') RETURNING * INTO revision;
    revision_id := revision.id;
  ELSE
    IF gameplay_action<>'keep' OR p_payload ? 'previewConsent' OR p_payload ? 'rightsConfirmation' THEN RAISE EXCEPTION 'SOURCE_REQUIRED' USING ERRCODE='22023'; END IF;
    revision_id := song.current_revision_id;
    SELECT duration_ms INTO duration FROM public.chart_revisions WHERE id=revision_id;
  END IF;
  PERFORM public.validate_song_metadata(song,m,duration);
  next_background := song.background_asset_id; next_path := song.background_path;
  IF background_action<>'keep' THEN
    IF NOT gates.background_enabled THEN RAISE EXCEPTION 'SERVER_NOT_READY' USING ERRCODE='55000'; END IF;
    -- Deterministic ordering shared with cleanup claim.
    PERFORM id FROM public.image_assets WHERE id IN (song.background_asset_id,(p_payload->'background'->>'assetId')::uuid) ORDER BY id FOR UPDATE;
    IF background_action='replace' THEN
      SELECT * INTO asset FROM public.image_assets WHERE id=(p_payload->'background'->>'assetId')::uuid;
      IF NOT FOUND OR asset.owner_id<>p_actor OR asset.purpose<>'chart-background' OR asset.target_id<>v_song_id OR asset.deleting OR asset.deleted_at IS NOT NULL OR
        NOT EXISTS(SELECT 1 FROM public.image_reservations r WHERE r.id=asset.id AND r.state='verified' AND (r.expires_at>now() OR asset.id=song.background_asset_id)) THEN
        RAISE EXCEPTION 'ASSET_NOT_READY' USING ERRCODE='22023';
      END IF;
      next_background := asset.id;
    ELSE next_background := NULL;
    END IF;
    IF song.background_path IS NOT NULL AND song.background_path LIKE p_actor::text||'/%' THEN
      INSERT INTO public.asset_cleanup_jobs(bucket_id,path,not_before) VALUES('songs',song.background_path,now()+interval '7 days')
        ON CONFLICT(bucket_id,path) DO UPDATE SET not_before=greatest(public.asset_cleanup_jobs.not_before,excluded.not_before),next_attempt_at=excluded.not_before;
    END IF;
    next_path := NULL;
    IF song.background_asset_id IS DISTINCT FROM next_background AND song.background_asset_id IS NOT NULL THEN
      SELECT * INTO old_asset FROM public.image_assets WHERE id=song.background_asset_id;
      INSERT INTO public.asset_cleanup_jobs(bucket_id,path,asset_id,not_before) VALUES('profile-card-images',old_asset.path,old_asset.id,now()+interval '24 hours')
        ON CONFLICT(bucket_id,path) DO UPDATE SET not_before=greatest(public.asset_cleanup_jobs.not_before,excluded.not_before),completed_at=NULL,next_attempt_at=excluded.not_before;
    END IF;
  END IF;
  IF ROW(song.title,song.artist,song.chart_author,song.difficulty_name,song.description,song.recommended_play_style,song.preview_start_ms,song.background_asset_id,song.background_path,song.current_revision_id)
    IS DISTINCT FROM ROW(m->>'title',m->>'artist',m->>'chartAuthor',m->>'difficultyName',m->>'description',m->>'recommendedPlayStyle',(m->>'previewStartMs')::integer,next_background,next_path,revision_id) THEN
    UPDATE public.songs SET title=m->>'title',artist=m->>'artist',chart_author=m->>'chartAuthor',difficulty_name=m->>'difficultyName',description=m->>'description',
      recommended_play_style=m->>'recommendedPlayStyle',preview_start_ms=(m->>'previewStartMs')::integer,background_asset_id=next_background,background_path=next_path,
      current_revision_id=revision_id,metadata_version=metadata_version+1,
      bpm=CASE WHEN source_id IS NULL THEN bpm ELSE (c->>'bpm')::double precision END,
      offset_sec=CASE WHEN source_id IS NULL THEN offset_sec ELSE (c->>'offset')::double precision END,
      note_count=CASE WHEN source_id IS NULL THEN note_count ELSE revision.note_count END
      WHERE id=v_song_id RETURNING * INTO song;
  END IF;
  receipt := jsonb_build_object('requestId',v_request_id,'song',public.song_settings_projection(song),'version',song.metadata_version::text,'revisionId',song.current_revision_id);
  INSERT INTO public.song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version,expected_revision_id,receipt)
    VALUES(v_request_id,p_actor,v_song_id,'save','committed',p_payload_hash,(p_payload->>'expectedVersion')::bigint,(p_payload->>'expectedRevisionId')::uuid,receipt)
    ON CONFLICT(id) DO UPDATE SET state='committed',receipt=excluded.receipt,updated_at=now();
  IF source_id IS NOT NULL THEN UPDATE public.song_edit_operations SET state='committed',updated_at=now() WHERE id=source_id; END IF;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_song_settings(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_song_settings(uuid,jsonb,text) TO service_role;

