-- Separate, read-only public aggregates keep profile editing permissions unchanged.
CREATE TABLE public.player_stats (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_score bigint NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  play_count bigint NOT NULL DEFAULT 0 CHECK (play_count >= 0)
);
CREATE INDEX player_stats_ranking_idx ON public.player_stats (total_score DESC, user_id);
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_stats FROM anon, authenticated;
GRANT SELECT ON public.player_stats TO anon, authenticated;
GRANT ALL ON public.player_stats TO service_role;
CREATE POLICY "Public player statistics" ON public.player_stats FOR SELECT USING (true);
INSERT INTO public.player_stats (user_id) SELECT id FROM public.profiles;

CREATE FUNCTION public.initialize_player_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.player_stats (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_player_stats() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_initialize_stats AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.initialize_player_stats();

CREATE TABLE public.play_results (
  id uuid PRIMARY KEY, -- generated once per successful START/RETRY; also the idempotency key
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Built-in charts have text IDs, uploaded songs have UUID IDs. Keep history after song deletion.
  song_id text NOT NULL CHECK (length(song_id) BETWEEN 1 AND 200),
  score bigint NOT NULL CHECK (score BETWEEN 0 AND 9007199254740991),
  accuracy numeric NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
  max_combo integer NOT NULL CHECK (max_combo >= 0),
  perfect_count integer NOT NULL CHECK (perfect_count >= 0),
  great_count integer NOT NULL CHECK (great_count >= 0),
  good_count integer NOT NULL CHECK (good_count >= 0),
  miss_count integer NOT NULL CHECK (miss_count >= 0),
  played_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_combo::bigint <= perfect_count::bigint + great_count::bigint + good_count::bigint)
);
CREATE INDEX play_results_user_time_idx ON public.play_results (user_id, played_at DESC);
ALTER TABLE public.play_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_results FROM anon, authenticated;
GRANT SELECT ON public.play_results TO authenticated;
GRANT INSERT (id, user_id, song_id, score, accuracy, max_combo, perfect_count, great_count, good_count, miss_count)
ON public.play_results TO authenticated;
GRANT ALL ON public.play_results TO service_role;
CREATE POLICY "Read own play history" ON public.play_results FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Insert own play results" ON public.play_results FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.accumulate_play_result() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.player_stats AS stats (user_id, total_score, play_count)
  VALUES (NEW.user_id, NEW.score, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET total_score = stats.total_score + EXCLUDED.total_score,
        play_count = stats.play_count + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accumulate_play_result() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER play_results_accumulate AFTER INSERT ON public.play_results
FOR EACH ROW EXECUTE FUNCTION public.accumulate_play_result();

-- Invoker retains RLS; a retried request returns false without running the INSERT trigger again.
CREATE FUNCTION public.record_play_result(
  p_id uuid, p_song_id text, p_score bigint, p_accuracy numeric, p_max_combo integer,
  p_perfect_count integer, p_great_count integer, p_good_count integer, p_miss_count integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE inserted_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.play_results (id, user_id, song_id, score, accuracy, max_combo, perfect_count, great_count, good_count, miss_count)
  VALUES (p_id, auth.uid(), p_song_id, p_score, p_accuracy, p_max_combo, p_perfect_count, p_great_count, p_good_count, p_miss_count)
  ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) TO authenticated;

-- Competition ranking: tied scores share a rank; UUID orders ties consistently in Top 100.
CREATE FUNCTION public.get_global_leaderboard()
RETURNS TABLE (user_id uuid, display_name text, username text, avatar_url text, total_score bigint, play_count bigint, global_rank bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.user_id, p.display_name, p.username, p.avatar_url, s.total_score, s.play_count,
    rank() OVER (ORDER BY s.total_score DESC) AS global_rank
  FROM public.player_stats s JOIN public.profiles p ON p.id = s.user_id
  ORDER BY s.total_score DESC, s.user_id LIMIT 100
$$;
CREATE FUNCTION public.get_player_ranking(p_user_id uuid)
RETURNS TABLE (user_id uuid, display_name text, username text, avatar_url text, total_score bigint, play_count bigint, global_rank bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.user_id, p.display_name, p.username, p.avatar_url, s.total_score, s.play_count,
    1 + (SELECT count(*) FROM public.player_stats other WHERE other.total_score > s.total_score)
  FROM public.player_stats s JOIN public.profiles p ON p.id = s.user_id WHERE s.user_id = p_user_id
$$;
REVOKE ALL ON FUNCTION public.get_global_leaderboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_ranking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(), public.get_player_ranking(uuid) TO anon, authenticated;
