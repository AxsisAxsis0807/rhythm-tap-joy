-- Expand only. Legacy rows and score history are deliberately not canonicalized here.
ALTER TABLE public.songs
  ADD COLUMN rights_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN preview_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN description text,
  ADD COLUMN recommended_play_style text CHECK (recommended_play_style IN ('mania', 'fnf')),
  ADD COLUMN preview_start_ms integer CHECK (preview_start_ms >= 0),
  ADD COLUMN metadata_version bigint NOT NULL DEFAULT 0 CHECK (metadata_version >= 0),
  ADD COLUMN current_revision_id uuid;
UPDATE public.songs SET recommended_play_style = mode_id WHERE mode_id IN ('mania', 'fnf');

CREATE TABLE public.chart_revisions (
  id uuid PRIMARY KEY,
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL,
  chart_key text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  chart_path text NOT NULL UNIQUE,
  audio_path text NOT NULL,
  chart_hash text NOT NULL CHECK (chart_hash ~ '^[a-f0-9]{64}$'),
  audio_hash text NOT NULL CHECK (audio_hash ~ '^[a-f0-9]{64}$'),
  parser_version text NOT NULL CHECK (parser_version = 'pulse-chart-v1'),
  duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 7200000),
  note_count integer NOT NULL CHECK (note_count > 0 AND note_count <= 100000),
  lane_count integer NOT NULL CHECK (lane_count = 4),
  fnf_side text CHECK (fnf_side IN ('left','right')),
  status text NOT NULL DEFAULT 'validated' CHECK (status = 'validated'),
  rights_confirmed_by uuid NOT NULL REFERENCES auth.users(id),
  rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
  preview_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_key, revision_number),
  UNIQUE (id, song_id),
  CHECK (chart_path = chart_key || '/' || id::text || '/chart.json'),
  CHECK (audio_path = chart_key || '/' || id::text || '/audio')
);
ALTER TABLE public.songs ADD CONSTRAINT songs_current_revision_fk
  FOREIGN KEY (current_revision_id, id) REFERENCES public.chart_revisions(id, song_id);
ALTER TABLE public.chart_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chart_revisions FROM anon, authenticated;
GRANT SELECT ON public.chart_revisions TO anon, authenticated;
GRANT SELECT, INSERT ON public.chart_revisions TO service_role;
CREATE POLICY "Readable song revisions" ON public.chart_revisions FOR SELECT
USING (EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_id AND (s.is_published OR s.user_id = (SELECT auth.uid()))));
CREATE FUNCTION public.reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.song_id IS NULL AND OLD.song_id IS NOT NULL AND (to_jsonb(NEW)-'song_id') = (to_jsonb(OLD)-'song_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Canonical revisions are immutable; create a new revision' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_revision_mutation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER chart_revisions_immutable BEFORE UPDATE OR DELETE ON public.chart_revisions
FOR EACH ROW EXECUTE FUNCTION public.reject_revision_mutation();

-- Revoke the table-wide grant before allowing only legacy publish/unpublish.
-- Existing uploads still INSERT drafts. Metadata changes must use the CAS RPC.
REVOKE UPDATE ON public.songs FROM authenticated;
GRANT UPDATE (is_published, published_at) ON public.songs TO authenticated;
CREATE FUNCTION public.protect_song_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.current_revision_id IS NOT NULL OR NEW.metadata_version <> 0 THEN
        RAISE EXCEPTION 'Revision pointers are server managed' USING ERRCODE = '42501';
      END IF;
      IF length(btrim(NEW.title)) NOT BETWEEN 1 AND 120 OR length(NEW.artist) > 120
        OR length(NEW.chart_author) > 120 OR length(NEW.difficulty_name) > 40
        OR length(coalesce(NEW.description,'')) > 2000 THEN
        RAISE EXCEPTION 'Invalid song metadata' USING ERRCODE = '22023';
      END IF;
      IF NEW.preview_start_ms IS NOT NULL AND NEW.preview_start_ms <> 0 THEN
        RAISE EXCEPTION 'Preview position requires a verified audio revision' USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id
      OR NEW.metadata_version IS DISTINCT FROM OLD.metadata_version THEN
      RAISE EXCEPTION 'Song identity and revision pointers are server managed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_song_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER songs_protect_identity BEFORE INSERT OR UPDATE ON public.songs
FOR EACH ROW EXECUTE FUNCTION public.protect_song_identity();

CREATE FUNCTION public.update_chart_metadata(
  p_song_id uuid, p_expected_version bigint, p_expected_revision uuid,
  p_title text, p_artist text, p_chart_author text, p_difficulty_name text,
  p_description text, p_recommended_play_style text, p_preview_start_ms integer
) RETURNS public.songs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE song public.songs; audio_duration integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO song FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF NOT FOUND OR song.user_id <> auth.uid() THEN RAISE EXCEPTION 'Song owner required' USING ERRCODE = '42501'; END IF;
  IF song.metadata_version <> p_expected_version OR song.current_revision_id IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'This song changed; reload the latest version before saving' USING ERRCODE = '40001';
  END IF;
  -- Existing long fields may remain unchanged; migration never truncates them.
  IF p_title IS NULL OR (p_title IS DISTINCT FROM song.title AND length(btrim(p_title)) NOT BETWEEN 1 AND 120)
    OR p_artist IS NULL OR (p_artist IS DISTINCT FROM song.artist AND length(p_artist) > 120)
    OR p_chart_author IS NULL OR (p_chart_author IS DISTINCT FROM song.chart_author AND length(p_chart_author) > 120)
    OR p_difficulty_name IS NULL OR (p_difficulty_name IS DISTINCT FROM song.difficulty_name AND length(p_difficulty_name) > 40)
    OR length(coalesce(p_description,'')) > 2000 OR p_recommended_play_style NOT IN ('mania','fnf')
    OR p_preview_start_ms < 0 THEN
    RAISE EXCEPTION 'Invalid song metadata' USING ERRCODE = '22023';
  END IF;
  IF p_preview_start_ms IS NOT NULL THEN
    SELECT duration_ms INTO audio_duration FROM public.chart_revisions WHERE id = song.current_revision_id;
    IF (audio_duration IS NULL AND p_preview_start_ms <> 0) OR p_preview_start_ms >= audio_duration THEN
      RAISE EXCEPTION 'Preview position is outside verified audio; select a new position' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.songs SET title = p_title, artist = p_artist, chart_author = p_chart_author,
    difficulty_name = p_difficulty_name, description = p_description,
    recommended_play_style = p_recommended_play_style, preview_start_ms = p_preview_start_ms,
    metadata_version = metadata_version + 1 WHERE id = p_song_id RETURNING * INTO song;
  RETURN song;
END;
$$;
REVOKE ALL ON FUNCTION public.update_chart_metadata(uuid,bigint,uuid,text,text,text,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_chart_metadata(uuid,bigint,uuid,text,text,text,text,text,text,integer) TO authenticated;

-- The authenticated server supplies actor identity after checking the session.
CREATE FUNCTION public.publish_chart_revision(
  p_actor uuid, p_song_id uuid, p_revision_id uuid, p_expected_revision uuid,
  p_expected_version bigint, p_preview_start_ms integer
) RETURNS public.songs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE song public.songs; revision public.chart_revisions;
BEGIN
  SELECT * INTO song FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF NOT FOUND OR song.user_id <> p_actor THEN RAISE EXCEPTION 'Song owner required' USING ERRCODE = '42501'; END IF;
  IF song.metadata_version <> p_expected_version OR song.current_revision_id IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'This song changed; reload before publishing' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO revision FROM public.chart_revisions WHERE id = p_revision_id AND song_id = p_song_id;
  IF NOT FOUND OR revision.rights_confirmed_by <> p_actor THEN RAISE EXCEPTION 'Validated revision and fresh rights confirmation required' USING ERRCODE = '22023'; END IF;
  IF p_preview_start_ms IS NULL OR p_preview_start_ms < 0 OR p_preview_start_ms >= revision.duration_ms THEN
    RAISE EXCEPTION 'Confirm preview position for this audio' USING ERRCODE = '22023';
  END IF;
  UPDATE public.songs SET current_revision_id = revision.id, metadata_version = metadata_version + 1,
    preview_start_ms = p_preview_start_ms, is_published = true, published_at = coalesce(published_at, now())
  WHERE id = p_song_id RETURNING * INTO song;
  RETURN song;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_chart_revision(uuid,uuid,uuid,uuid,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_chart_revision(uuid,uuid,uuid,uuid,bigint,integer) TO service_role;
