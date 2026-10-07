-- Harden browser-submitted results using invariants from the current scoring engine.
-- This cannot prove that a browser really played the chart; authoritative anti-cheat
-- would require a trusted chart/replay verifier.
CREATE OR REPLACE FUNCTION public.record_play_result(
  p_id uuid, p_song_id text, p_score bigint, p_accuracy numeric, p_max_combo integer,
  p_perfect_count integer, p_great_count integer, p_good_count integer, p_miss_count integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  inserted_id uuid;
  judged bigint;
  hits bigint;
  expected_accuracy numeric;
  base_score bigint;
  minimum_score bigint;
  maximum_score bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_song_id IS NULL OR length(btrim(p_song_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid song id' USING ERRCODE = '22023';
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 9007199254740991 OR
     p_accuracy IS NULL OR p_accuracy < 0 OR p_accuracy > 100 OR
     p_max_combo IS NULL OR p_max_combo < 0 OR
     p_perfect_count IS NULL OR p_perfect_count < 0 OR
     p_great_count IS NULL OR p_great_count < 0 OR
     p_good_count IS NULL OR p_good_count < 0 OR
     p_miss_count IS NULL OR p_miss_count < 0 THEN
    RAISE EXCEPTION 'Invalid play result values' USING ERRCODE = '22023';
  END IF;

  judged := p_perfect_count::bigint + p_great_count::bigint +
    p_good_count::bigint + p_miss_count::bigint;
  hits := p_perfect_count::bigint + p_great_count::bigint + p_good_count::bigint;
  IF p_max_combo::bigint > hits OR (hits = 0 AND p_max_combo <> 0) THEN
    RAISE EXCEPTION 'Combo is inconsistent with judgements' USING ERRCODE = '22023';
  END IF;
  expected_accuracy := CASE WHEN judged = 0 THEN 100 ELSE
    (p_perfect_count::numeric + p_great_count::numeric * 0.7 +
      p_good_count::numeric * 0.4) * 100 / judged::numeric END;
  IF abs(p_accuracy - expected_accuracy) > 0.000001 THEN
    RAISE EXCEPTION 'Accuracy is inconsistent with judgements' USING ERRCODE = '22023';
  END IF;

  base_score := p_perfect_count::bigint * 1000 + p_great_count::bigint * 700 +
    p_good_count::bigint * 300;
  minimum_score := base_score + hits * 2;
  maximum_score := base_score + hits * least(p_max_combo * 2, 200);
  IF (hits = 0 AND p_score <> 0) OR
     (hits > 0 AND (p_max_combo = 0 OR p_score < minimum_score OR p_score > maximum_score)) THEN
    RAISE EXCEPTION 'Score is inconsistent with judgements and combo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.play_results
    (id, user_id, song_id, score, accuracy, max_combo, perfect_count, great_count, good_count, miss_count)
  VALUES
    (p_id, auth.uid(), btrim(p_song_id), p_score, p_accuracy, p_max_combo,
     p_perfect_count, p_great_count, p_good_count, p_miss_count)
  ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) TO authenticated;

-- PostgREST JSON numbers lose precision above Number.MAX_SAFE_INTEGER. Return
-- bigint values as decimal text so clients can format them with BigInt exactly.
DROP FUNCTION public.get_global_leaderboard();
DROP FUNCTION public.get_player_ranking(uuid);

CREATE FUNCTION public.get_global_leaderboard()
RETURNS TABLE (user_id uuid, display_name text, username text, avatar_url text,
  total_score text, play_count text, global_rank text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.user_id, p.display_name, p.username, p.avatar_url,
    s.total_score::text, s.play_count::text,
    rank() OVER (ORDER BY s.total_score DESC)::text
  FROM public.player_stats s JOIN public.profiles p ON p.id = s.user_id
  ORDER BY s.total_score DESC, s.user_id LIMIT 100
$$;

CREATE FUNCTION public.get_player_ranking(p_user_id uuid)
RETURNS TABLE (user_id uuid, display_name text, username text, avatar_url text,
  total_score text, play_count text, global_rank text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.user_id, p.display_name, p.username, p.avatar_url,
    s.total_score::text, s.play_count::text,
    (1 + (SELECT count(*) FROM public.player_stats other
      WHERE other.total_score > s.total_score))::text
  FROM public.player_stats s JOIN public.profiles p ON p.id = s.user_id
  WHERE s.user_id = p_user_id
$$;
REVOKE ALL ON FUNCTION public.get_global_leaderboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_ranking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(), public.get_player_ranking(uuid)
TO anon, authenticated;
