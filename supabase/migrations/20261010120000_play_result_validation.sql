-- Additive hardening; do not rewrite previously published migrations.
-- Validate direct INSERTs as well as RPCs. Existing rows are left untouched.
CREATE FUNCTION public.validate_play_result() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  hits bigint;
  judged bigint;
  combo bigint := NEW.max_combo::bigint;
  expected_accuracy numeric;
  base_score bigint;
  combo_score bigint;
  remainder bigint;
  minimum_score bigint;
  maximum_score bigint;
BEGIN
  IF NEW.id IS NULL OR NEW.song_id IS NULL OR
    length(btrim(NEW.song_id)) NOT BETWEEN 1 AND 200 OR
    NEW.score IS NULL OR NEW.score NOT BETWEEN 0 AND 9007199254740991 OR
    NEW.accuracy IS NULL OR NEW.accuracy NOT BETWEEN 0 AND 100 OR
    combo IS NULL OR combo < 0 OR
    NEW.perfect_count IS NULL OR NEW.perfect_count < 0 OR
    NEW.great_count IS NULL OR NEW.great_count < 0 OR
    NEW.good_count IS NULL OR NEW.good_count < 0 OR
    NEW.miss_count IS NULL OR NEW.miss_count < 0 THEN
    RAISE EXCEPTION 'Invalid play result values' USING ERRCODE = '22023';
  END IF;
  hits := NEW.perfect_count::bigint + NEW.great_count::bigint + NEW.good_count::bigint;
  judged := hits + NEW.miss_count::bigint;
  IF combo > hits OR (hits = 0 AND combo <> 0) OR
    (hits > 0 AND (combo = 0 OR combo < (hits + NEW.miss_count::bigint) / (NEW.miss_count::bigint + 1))) THEN
    RAISE EXCEPTION 'Combo is inconsistent with judgements' USING ERRCODE = '22023';
  END IF;
  expected_accuracy := CASE WHEN judged = 0 THEN 100 ELSE
    (NEW.perfect_count::numeric + NEW.great_count::numeric * 0.7 + NEW.good_count::numeric * 0.4) * 100 / judged END;
  IF abs(NEW.accuracy - expected_accuracy) > 0.000001 THEN
    RAISE EXCEPTION 'Accuracy is inconsistent with judgements' USING ERRCODE = '22023';
  END IF;
  base_score := NEW.perfect_count::bigint * 1000 + NEW.great_count::bigint * 700 + NEW.good_count::bigint * 300;
  -- Each hit earns min(combo * 2, 200). At least one streak attains max_combo.
  combo_score := least(combo, 100) * (least(combo, 100) + 1) + greatest(combo - 100, 0) * 200;
  minimum_score := base_score + combo_score + (hits - combo) * 2;
  IF hits = 0 THEN
    maximum_score := 0;
  ELSE
    remainder := hits % combo;
    maximum_score := base_score + (hits / combo) * combo_score +
      least(remainder, 100) * (least(remainder, 100) + 1) + greatest(remainder - 100, 0) * 200;
  END IF;
  IF NEW.score < minimum_score OR NEW.score > maximum_score OR
    (NEW.miss_count = 0 AND NEW.score <> maximum_score) THEN
    RAISE EXCEPTION 'Score is inconsistent with judgements and combo' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_play_result() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER play_results_validate BEFORE INSERT ON public.play_results
FOR EACH ROW EXECUTE FUNCTION public.validate_play_result();

-- Keep the existing RPC signature and RLS. Repeated UUIDs are acknowledgements
-- only when both the owner and immutable payload match, never silent collisions.
CREATE OR REPLACE FUNCTION public.record_play_result(
  p_id uuid, p_song_id text, p_score bigint, p_accuracy numeric, p_max_combo integer,
  p_perfect_count integer, p_great_count integer, p_good_count integer, p_miss_count integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE inserted_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.play_results
    (id, user_id, song_id, score, accuracy, max_combo, perfect_count, great_count, good_count, miss_count)
  VALUES (p_id, auth.uid(), btrim(p_song_id), p_score, p_accuracy, p_max_combo,
    p_perfect_count, p_great_count, p_good_count, p_miss_count)
  ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.play_results r WHERE r.id = p_id AND r.user_id = auth.uid()
      AND r.song_id = btrim(p_song_id) AND r.score = p_score
      AND abs(r.accuracy - p_accuracy) <= 0.000001 AND r.max_combo = p_max_combo
      AND r.perfect_count = p_perfect_count AND r.great_count = p_great_count
      AND r.good_count = p_good_count AND r.miss_count = p_miss_count
  ) THEN
    RAISE EXCEPTION 'Play UUID conflicts with a different result' USING ERRCODE = '22023';
  END IF;
  RETURN inserted_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_play_result(uuid,text,bigint,numeric,integer,integer,integer,integer,integer) TO authenticated;
