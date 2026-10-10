-- Additive migration; never rewrites scores, profiles or uploaded songs.
CREATE TABLE public.xp_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  level_step integer NOT NULL DEFAULT 500 CHECK (level_step = 500),
  play_xp integer NOT NULL DEFAULT 90 CHECK (play_xp BETWEEN 0 AND 10000),
  first_clear_xp integer NOT NULL DEFAULT 50 CHECK (first_clear_xp BETWEEN 0 AND 10000),
  daily_xp integer NOT NULL DEFAULT 50 CHECK (daily_xp BETWEEN 0 AND 10000),
  daily_cap integer NOT NULL DEFAULT 1000 CHECK (daily_cap BETWEEN 1 AND 100000)
);
INSERT INTO public.xp_policy DEFAULT VALUES;
CREATE TABLE public.account_visibility (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_public boolean NOT NULL DEFAULT true,
  xp_public boolean NOT NULL DEFAULT false,
  supporter_public boolean NOT NULL DEFAULT true
);
CREATE TABLE public.xp_progress (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_xp bigint NOT NULL DEFAULT 0 CHECK (total_xp >= 0)
);
-- Entitlements are written only by a trusted synchronization job, never users.
CREATE TABLE public.supporter_entitlements (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge text NOT NULL CHECK (length(badge) BETWEEN 1 AND 40),
  tier text NOT NULL CHECK (length(tier) BETWEEN 1 AND 80),
  active_until timestamptz NOT NULL
);
-- Each selected FNF side has its own digest; chart contains BOTH authored sides.
-- Existing song owners can edit their songs, so this registry is independent.
CREATE TABLE public.chart_revisions (
  digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  song_id text NOT NULL CHECK (length(song_id) BETWEEN 1 AND 200),
  chart jsonb NOT NULL,
  audio_duration numeric NOT NULL CHECK (audio_duration > 0 AND audio_duration <= 7200),
  verifier_version integer NOT NULL DEFAULT 1 CHECK (verifier_version = 1),
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.freeze_chart_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
  IF NEW.digest IS DISTINCT FROM OLD.digest OR NEW.song_id IS DISTINCT FROM OLD.song_id OR
     NEW.chart IS DISTINCT FROM OLD.chart OR NEW.audio_duration IS DISTINCT FROM OLD.audio_duration OR
     NEW.verifier_version IS DISTINCT FROM OLD.verifier_version THEN
    RAISE EXCEPTION 'Create a new immutable revision instead' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_chart_revision BEFORE UPDATE ON public.chart_revisions
FOR EACH ROW EXECUTE FUNCTION public.freeze_chart_revision();
CREATE TABLE public.verified_play_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  play_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revision text NOT NULL REFERENCES public.chart_revisions(digest),
  timing_offset_ms numeric NOT NULL CHECK (timing_offset_ms BETWEEN -300 AND 300),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '7 days')
);
CREATE INDEX verified_play_sessions_owner_time ON public.verified_play_sessions(user_id, issued_at DESC);
CREATE TABLE public.xp_ledger (
  play_id uuid PRIMARY KEY REFERENCES public.play_results(id),
  session_id uuid NOT NULL UNIQUE REFERENCES public.verified_play_sessions(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revision text NOT NULL REFERENCES public.chart_revisions(digest),
  replay_digest text NOT NULL CHECK (replay_digest ~ '^[a-f0-9]{64}$'),
  reward_day date NOT NULL,
  eligible boolean NOT NULL,
  earned_xp integer NOT NULL CHECK (earned_xp >= 0),
  outcome jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX xp_ledger_day ON public.xp_ledger(user_id, reward_day);
CREATE INDEX xp_ledger_chart ON public.xp_ledger(user_id, revision) WHERE eligible;

ALTER TABLE public.xp_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supporter_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_play_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xp_policy, public.account_visibility, public.xp_progress,
  public.supporter_entitlements, public.chart_revisions, public.verified_play_sessions, public.xp_ledger
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.xp_policy, public.account_visibility, public.xp_progress,
  public.supporter_entitlements, public.chart_revisions, public.verified_play_sessions, public.xp_ledger TO service_role;
GRANT SELECT ON public.account_visibility, public.xp_progress, public.supporter_entitlements,
  public.verified_play_sessions, public.xp_ledger TO authenticated;
CREATE POLICY own_visibility ON public.account_visibility FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_growth ON public.xp_progress FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_supporter ON public.supporter_entitlements FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_sessions ON public.verified_play_sessions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_rewards ON public.xp_ledger FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.set_account_visibility(p_level boolean, p_xp boolean, p_supporter boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_level IS NULL OR p_xp IS NULL OR p_supporter IS NULL THEN RAISE EXCEPTION 'Missing setting' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.account_visibility VALUES(auth.uid(), p_level, p_xp, p_supporter)
  ON CONFLICT (user_id) DO UPDATE SET level_public=p_level, xp_public=p_xp, supporter_public=p_supporter;
  RETURN jsonb_build_object('levelPublic',p_level,'xpPublic',p_xp,'supporterPublic',p_supporter);
END $$;
CREATE FUNCTION public.xp_growth(p_total bigint, p_public boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT jsonb_build_object('level',(p_total/500+1)::text,'nextLevel',(p_total/500+2)::text,
   'totalXp',p_total::text,'xpInLevel',(p_total%500)::text,'xpToNextLevel','500','levelPublic',p_public)
$$;
CREATE FUNCTION public.get_account_growth() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.xp_policy; v public.account_visibility; total bigint; supporter jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.xp_policy WHERE id;
  SELECT * INTO v FROM public.account_visibility WHERE user_id=auth.uid();
  SELECT total_xp INTO total FROM public.xp_progress WHERE user_id=auth.uid();
  SELECT jsonb_build_object('badge',s.badge,'tier',s.tier,'syncState','連携済み') INTO supporter
    FROM public.supporter_entitlements s WHERE user_id=auth.uid() AND active_until > now();
  RETURN jsonb_build_object('enabled',p.enabled,'growth',public.xp_growth(coalesce(total,0),coalesce(v.level_public,true)),
    'visibility',jsonb_build_object('levelPublic',coalesce(v.level_public,true),'xpPublic',coalesce(v.xp_public,false),
      'supporterPublic',coalesce(v.supporter_public,true)), 'supporter', supporter, 'boostEnabled',false,
    'rules',jsonb_build_array(
      '管理側で承認した譜面Revisionの通常完走を、サーバー発行Sessionとreplayで検証します。Practice・Autoplay・未審査譜面は対象外です。採点対象の成功判定が1つ以上必要です。',
      'プレイ +'||p.play_xp||' XP。初クリア +'||p.first_clear_xp||' XP、UTC日ごとの初回 +'||p.daily_xp||' XP。',
      '同一譜面Revision（FNFは選択側別）のUTC日内倍率は100% → 50% → 25% → 0%。倍率はプレイXPだけに適用し、小数点以下は切り捨てます。',
      '日次合計上限は'||p.daily_cap||' XP。ボーナスも上限内で、プレイ・初クリア・デイリーの順に付与します。',
      '1 Levelにつき500 XP。日次の基準はSession発行日（UTC）です。XP Boostは無効です。'));
END $$;
CREATE FUNCTION public.get_public_account_growth(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.account_visibility; total bigint; supporter jsonb; result jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_user_id) OR
     NOT EXISTS (SELECT 1 FROM public.xp_policy WHERE id AND enabled) THEN RETURN result; END IF;
  SELECT * INTO v FROM public.account_visibility WHERE user_id=p_user_id;
  SELECT coalesce(total_xp,0) INTO total FROM public.xp_progress WHERE user_id=p_user_id;
  total := coalesce(total,0);
  -- Level-only publication never includes progress, nextLevel, totalXP or remainingXP.
  IF coalesce(v.level_public,true) THEN result := result || jsonb_build_object('level',(total/500+1)::text); END IF;
  IF coalesce(v.level_public,true) AND coalesce(v.xp_public,false) THEN result := result || jsonb_build_object('totalXp',total::text,
    'xpInLevel',(total%500)::text,'xpToNextLevel','500'); END IF;
  IF coalesce(v.supporter_public,true) THEN
    SELECT jsonb_build_object('badge',s.badge,'tier',s.tier) INTO supporter
      FROM public.supporter_entitlements s WHERE user_id=p_user_id AND active_until > now();
    IF supporter IS NOT NULL THEN result := result || jsonb_build_object('supporter',supporter); END IF;
  END IF;
  RETURN result;
END $$;
-- DB is the session issuer. Browser may select a revision, never register/approve it.
CREATE FUNCTION public.begin_verified_play(p_play_id uuid, p_revision text, p_offset numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.verified_play_sessions; r public.chart_revisions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.xp_policy WHERE id AND enabled) THEN RETURN jsonb_build_object('reason','disabled'); END IF;
  SELECT * INTO r FROM public.chart_revisions WHERE digest=p_revision AND approved;
  IF r.digest IS NULL THEN RETURN jsonb_build_object('reason','unreviewed'); END IF;
  IF p_offset IS NULL OR p_offset NOT BETWEEN -300 AND 300 OR p_play_id IS NULL THEN
    RAISE EXCEPTION 'Invalid session options' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.verified_play_sessions WHERE play_id=p_play_id;
  IF s.id IS NOT NULL THEN
    IF s.user_id<>auth.uid() OR s.revision<>p_revision OR s.timing_offset_ms<>p_offset THEN
      RAISE EXCEPTION 'Session conflict' USING ERRCODE='22023'; END IF;
  ELSE
    -- Bound issuance spam without constraining keyboard speed or simultaneous notes.
    PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
    -- A concurrent retry may have issued this same play while we waited.
    SELECT * INTO s FROM public.verified_play_sessions WHERE play_id=p_play_id;
    IF s.id IS NULL AND (SELECT count(*) FROM public.verified_play_sessions WHERE user_id=auth.uid() AND issued_at>now()-interval '1 hour') >= 120 THEN
      RETURN jsonb_build_object('reason','session_limit'); END IF;
    INSERT INTO public.verified_play_sessions(play_id,user_id,revision,timing_offset_ms)
      VALUES(p_play_id,auth.uid(),p_revision,p_offset) ON CONFLICT(play_id) DO NOTHING;
    SELECT * INTO s FROM public.verified_play_sessions WHERE play_id=p_play_id;
    IF s.user_id<>auth.uid() OR s.revision<>p_revision OR s.timing_offset_ms<>p_offset THEN
      RAISE EXCEPTION 'Session conflict' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN jsonb_build_object('sessionId',s.id,'revision',s.revision);
END $$;
-- Only trusted verifier server can call this. No XP/Level parameter is accepted.
-- Score is already committed in a different transaction; any XP error leaves it intact.
CREATE FUNCTION public.commit_verified_xp(p_session uuid,p_digest text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.verified_play_sessions; r public.chart_revisions; policy public.xp_policy;
  old public.xp_ledger; saved public.play_results; total bigint; day date;
  used integer; repeats integer; base integer:=0; first_bonus integer:=0; daily_bonus integer:=0;
  remaining integer; earned integer; reason text; previous text; outcome jsonb; is_eligible boolean:=false;
BEGIN
  SELECT * INTO s FROM public.verified_play_sessions WHERE id=p_session;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown session' USING ERRCODE='22023'; END IF;
  INSERT INTO public.xp_progress(user_id) VALUES(s.user_id) ON CONFLICT DO NOTHING;
  SELECT total_xp INTO total FROM public.xp_progress WHERE user_id=s.user_id FOR UPDATE;
  SELECT * INTO old FROM public.xp_ledger WHERE play_id=s.play_id;
  IF old.play_id IS NOT NULL THEN
    IF old.session_id<>p_session OR old.replay_digest<>p_digest THEN RAISE EXCEPTION 'Replay conflict' USING ERRCODE='22023'; END IF;
    RETURN old.outcome;
  END IF;
  SELECT * INTO saved FROM public.play_results WHERE id=s.play_id AND user_id=s.user_id;
  SELECT * INTO r FROM public.chart_revisions WHERE digest=s.revision;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'Score pending' USING ERRCODE='40001'; END IF;
  IF saved.song_id<>r.song_id OR saved.score::text<>p_result->>'score' OR saved.max_combo::text<>p_result->>'maxCombo' OR
     saved.perfect_count::text<>p_result->>'perfect' OR saved.great_count::text<>p_result->>'great' OR
     saved.good_count::text<>p_result->>'good' OR saved.miss_count::text<>p_result->>'miss' THEN
    RAISE EXCEPTION 'Verified result does not match saved score' USING ERRCODE='22023'; END IF;
  IF p_result IS NULL OR NOT p_result ?& ARRAY['score','maxCombo','perfect','great','good','miss','accuracy','elapsedMs'] OR
     abs(saved.accuracy-(p_result->>'accuracy')::numeric)>0.000001 THEN
    RAISE EXCEPTION 'Missing or inconsistent verified result' USING ERRCODE='22023'; END IF;
  SELECT * INTO policy FROM public.xp_policy WHERE id;
  day := (s.issued_at AT TIME ZONE 'UTC')::date;
  SELECT coalesce(sum(earned_xp),0)::integer INTO used FROM public.xp_ledger WHERE user_id=s.user_id AND reward_day=day;
  SELECT count(*)::integer INTO repeats FROM public.xp_ledger WHERE user_id=s.user_id AND revision=s.revision AND reward_day=day AND eligible;
  IF NOT policy.enabled THEN reason:='disabled';
  ELSIF NOT r.approved THEN reason:='unreviewed';
  ELSIF clock_timestamp()>s.expires_at THEN reason:='expired';
  ELSIF (p_result->>'elapsedMs')::numeric/1000 > extract(epoch FROM clock_timestamp()-s.issued_at)+2 THEN reason:='elapsed';
  ELSIF used>=policy.daily_cap THEN reason:='daily_cap';
  ELSIF repeats>=3 THEN reason:='repeat_limit';
  ELSIF (p_result->>'perfect')::integer+(p_result->>'great')::integer+(p_result->>'good')::integer=0 THEN reason:='no_hits';
  ELSE
    is_eligible:=true;
    base := CASE repeats WHEN 0 THEN policy.play_xp WHEN 1 THEN policy.play_xp/2 ELSE policy.play_xp/4 END;
    IF NOT EXISTS(SELECT 1 FROM public.xp_ledger WHERE user_id=s.user_id AND revision=s.revision AND eligible) THEN first_bonus:=policy.first_clear_xp; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.xp_ledger WHERE user_id=s.user_id AND reward_day=day AND eligible) THEN daily_bonus:=policy.daily_xp; END IF;
    remaining:=policy.daily_cap-used;
    base:=least(base,remaining); remaining:=remaining-base;
    first_bonus:=least(first_bonus,remaining); remaining:=remaining-first_bonus;
    daily_bonus:=least(daily_bonus,remaining);
  END IF;
  earned:=base+first_bonus+daily_bonus;
  previous := (total/500+1)::text;
  IF is_eligible THEN
    total:=total+earned;
    UPDATE public.xp_progress SET total_xp=total WHERE user_id=s.user_id;
    outcome:=jsonb_build_object('status','awarded','earnedXp',earned::text,'previousLevel',previous,
      'growth',public.xp_growth(total,coalesce((SELECT level_public FROM public.account_visibility WHERE user_id=s.user_id),true)),
      'breakdown',jsonb_build_array(jsonb_build_object('label','プレイ','xp',base::text),
        jsonb_build_object('label','初クリア','xp',first_bonus::text),jsonb_build_object('label','デイリーボーナス','xp',daily_bonus::text)));
  ELSE outcome:=jsonb_build_object('status','ineligible','reason',reason); END IF;
  INSERT INTO public.xp_ledger VALUES(s.play_id,s.id,s.user_id,s.revision,p_digest,day,is_eligible,earned,outcome,now());
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.freeze_chart_revision(), public.xp_growth(bigint,boolean),
 public.set_account_visibility(boolean,boolean,boolean), public.get_account_growth(),
 public.get_public_account_growth(uuid), public.begin_verified_play(uuid,text,numeric),
 public.commit_verified_xp(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_account_growth(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_visibility(boolean,boolean,boolean),public.get_account_growth(),
 public.begin_verified_play(uuid,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_verified_xp(uuid,text,jsonb),public.get_account_growth(),
 public.get_public_account_growth(uuid),public.xp_growth(bigint,boolean) TO service_role;
