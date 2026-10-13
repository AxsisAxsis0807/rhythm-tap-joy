-- XP is an independent, server-verified ledger. Existing SCORE writes are untouched.
-- Activation requires real PostgreSQL concurrency, Storage and verifier parity gates.
CREATE TABLE public.xp_feature_flags (
  name text PRIMARY KEY CHECK (name IN ('xp_sessions','xp_awards','xp_progress')),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.xp_feature_flags(name) VALUES ('xp_sessions'),('xp_awards'),('xp_progress');
CREATE TABLE public.chart_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE CHECK (length(group_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.xp_catalog (
  revision_id uuid NOT NULL REFERENCES public.chart_revisions(id),
  side text NOT NULL CHECK (side IN ('single','left','right')),
  group_id uuid NOT NULL REFERENCES public.chart_groups(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','revoked')),
  rule_version text NOT NULL DEFAULT 'pulse-xp-v1' CHECK (rule_version = 'pulse-xp-v1'),
  score_rules_version text NOT NULL,
  allowed_policies text[] NOT NULL DEFAULT ARRAY['pulse-mania-v1','pulse-fnf-v1'],
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  PRIMARY KEY (revision_id, side),
  CHECK (state <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(review_reason) > 0))
);
CREATE TABLE public.player_progress (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp bigint NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.play_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_nonce uuid NOT NULL,
  revision_id uuid NOT NULL REFERENCES public.chart_revisions(id),
  side text NOT NULL,
  group_id uuid NOT NULL REFERENCES public.chart_groups(id),
  configuration jsonb NOT NULL,
  catalog_snapshot jsonb NOT NULL,
  rule_version text NOT NULL DEFAULT 'pulse-xp-v1',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','accepted','completed','ineligible')),
  finish_hash text,
  reward_date date,
  accepted_at timestamptz,
  UNIQUE(user_id,request_nonce)
);
CREATE UNIQUE INDEX one_active_xp_session ON public.play_sessions(user_id) WHERE status='active';
CREATE TABLE public.play_evidence (
  session_id uuid PRIMARY KEY REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  payload jsonb,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz,
  CHECK (payload IS NULL OR octet_length(payload::text) <= 8388608)
);
CREATE TABLE public.verification_jobs (
  session_id uuid PRIMARY KEY REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','retry')),
  attempts integer NOT NULL DEFAULT 0,
  leased_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verified_plays (
  session_id uuid PRIMARY KEY REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  verified_result jsonb NOT NULL,
  eligible boolean NOT NULL,
  reason text,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.xp_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_date date NOT NULL,
  awarded_total integer NOT NULL DEFAULT 0 CHECK (awarded_total BETWEEN 0 AND 1500),
  daily_bonus_consumed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(user_id,reward_date)
);
CREATE TABLE public.xp_group_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.chart_groups(id),
  reward_date date NOT NULL,
  completions integer NOT NULL DEFAULT 0 CHECK (completions >= 0),
  PRIMARY KEY(user_id,group_id,reward_date)
);
CREATE TABLE public.xp_first_clears (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.chart_groups(id),
  first_session uuid NOT NULL UNIQUE REFERENCES public.play_sessions(id),
  first_cleared_at timestamptz NOT NULL DEFAULT now(),
  bonus_awarded integer NOT NULL CHECK (bonus_awarded BETWEEN 0 AND 50),
  PRIMARY KEY(user_id,group_id)
);
CREATE TABLE public.xp_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.play_sessions(id),
  reward_type text NOT NULL CHECK (reward_type IN ('daily_bonus','first_clear_bonus','play','correction')),
  amount bigint NOT NULL,
  rule_version text NOT NULL,
  reward_date date NOT NULL,
  source_id uuid REFERENCES public.xp_ledger(id),
  correction_id uuid UNIQUE,
  reason text,
  operator_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,reward_type),
  CHECK ((reward_type <> 'correction' AND amount >= 0 AND session_id IS NOT NULL AND correction_id IS NULL)
    OR (reward_type='correction' AND session_id IS NULL AND correction_id IS NOT NULL AND source_id IS NOT NULL AND operator_id IS NOT NULL AND length(reason)>0))
);
CREATE TABLE public.xp_receipts (
  session_id uuid PRIMARY KEY REFERENCES public.play_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['xp_feature_flags','chart_groups','xp_catalog','player_progress','play_sessions','play_evidence','verification_jobs','verified_plays','xp_daily','xp_group_daily','xp_first_clears','xp_ledger','xp_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
  END LOOP;
END $$;

CREATE FUNCTION public.xp_growth_snapshot(p_total bigint, p_public boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE lo bigint := 1; hi bigint := 2; mid bigint; threshold numeric;
BEGIN
  IF p_total < 0 THEN RAISE EXCEPTION 'negative XP'; END IF;
  WHILE 25::numeric*(hi-1)*(hi+18) <= p_total LOOP hi := hi*2; END LOOP;
  WHILE hi-lo > 1 LOOP
    mid := (lo+hi)/2;
    threshold := 25::numeric*(mid-1)*(mid+18);
    IF threshold <= p_total THEN lo := mid; ELSE hi := mid; END IF;
  END LOOP;
  RETURN jsonb_build_object('level',lo::text,'nextLevel',(lo+1)::text,'totalXp',p_total::text,
    'xpInLevel',(p_total-25::numeric*(lo-1)*(lo+18))::text,
    'xpToNextLevel',(500+50*(lo-1))::text,'levelPublic',p_public);
END $$;

CREATE FUNCTION public.get_own_xp_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE total bigint; visible boolean; enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT f.enabled INTO enabled FROM public.xp_feature_flags f WHERE name='xp_progress';
  IF NOT enabled THEN RETURN jsonb_build_object('enabled',false,'growth',NULL); END IF;
  SELECT p.total_xp INTO total FROM public.player_progress p WHERE p.user_id=auth.uid();
  SELECT p.level_public INTO visible FROM public.profile_preferences p WHERE p.user_id=auth.uid();
  RETURN jsonb_build_object('enabled',true,'growth',public.xp_growth_snapshot(coalesce(total,0),coalesce(visible,true)));
END $$;
CREATE FUNCTION public.get_public_xp_progress(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE total bigint; visible boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.xp_feature_flags WHERE name='xp_progress' AND enabled) THEN RETURN NULL; END IF;
  SELECT p.level_public INTO visible FROM public.profile_preferences p WHERE p.user_id=p_user_id;
  IF NOT coalesce(visible,true) AND auth.uid() IS DISTINCT FROM p_user_id THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_user_id) THEN RETURN NULL; END IF;
  SELECT p.total_xp INTO total FROM public.player_progress p WHERE p.user_id=p_user_id;
  RETURN public.xp_growth_snapshot(coalesce(total,0),coalesce(visible,true));
END $$;
CREATE FUNCTION public.get_xp_receipt(p_play_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN r.receipt IS NOT NULL THEN jsonb_build_object('sessionId',s.id,'outcome',r.receipt)
             WHEN s.status='accepted' THEN jsonb_build_object('sessionId',s.id,'outcome',jsonb_build_object('status','pending'))
             ELSE NULL END
 FROM public.play_sessions s LEFT JOIN public.xp_receipts r ON r.session_id=s.id
 WHERE s.id=p_play_id AND s.user_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.xp_growth_snapshot(bigint,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_own_xp_progress() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_public_xp_progress(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_xp_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_own_xp_progress(),public.get_xp_receipt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_xp_progress(uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.xp_growth_snapshot(bigint,boolean) TO service_role;
