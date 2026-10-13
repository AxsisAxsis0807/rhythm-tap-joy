-- Self-reported run context is separate from verified XP evidence. v1 stays unchanged.
CREATE TABLE public.play_result_context (
 play_id uuid PRIMARY KEY REFERENCES public.play_results(id),
 revision_id uuid REFERENCES public.chart_revisions(id),
 play_style text NOT NULL CHECK(play_style IN ('mania','fnf')),
 policy_id text NOT NULL CHECK(policy_id IN ('pulse-mania-v1','pulse-fnf-v1')),
 parser_version text NOT NULL,
 scoring_side text NOT NULL CHECK(scoring_side IN ('left','right','shared')),
 provenance text NOT NULL DEFAULT 'client' CHECK(provenance='client')
);
ALTER TABLE public.play_result_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_result_context FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.play_result_context TO authenticated;
GRANT SELECT,INSERT ON public.play_result_context TO service_role;
CREATE POLICY "Own result context" ON public.play_result_context FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.play_results r WHERE r.id=play_id AND r.user_id=auth.uid()));
CREATE FUNCTION public.record_play_result_v2(p_id uuid,p_song_id text,p_score bigint,p_accuracy numeric,p_max_combo integer,p_perfect_count integer,p_great_count integer,p_good_count integer,p_miss_count integer,p_revision_id uuid,p_play_style text,p_policy_id text,p_parser_version text,p_scoring_side text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted boolean; prior public.play_result_context;
BEGIN
 IF p_play_style NOT IN ('mania','fnf') OR p_play_style IS NULL OR p_policy_id IS DISTINCT FROM (CASE WHEN p_play_style='fnf' THEN 'pulse-fnf-v1' ELSE 'pulse-mania-v1' END)
 OR p_parser_version IS DISTINCT FROM 'pulse-chart-v1' OR p_scoring_side NOT IN ('left','right','shared') OR p_scoring_side IS NULL THEN RAISE EXCEPTION 'Invalid result context' USING ERRCODE='22023'; END IF;
 IF p_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chart_revisions WHERE id=p_revision_id AND chart_key=p_song_id) THEN RAISE EXCEPTION 'Revision does not match song' USING ERRCODE='22023'; END IF;
 inserted:=public.record_play_result(p_id,p_song_id,p_score,p_accuracy,p_max_combo,p_perfect_count,p_great_count,p_good_count,p_miss_count);
 PERFORM 1 FROM public.play_results WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Result owner required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.play_result_context(play_id,revision_id,play_style,policy_id,parser_version,scoring_side) VALUES(p_id,p_revision_id,p_play_style,p_policy_id,p_parser_version,p_scoring_side) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM public.play_result_context WHERE play_id=p_id;
 IF prior.revision_id IS DISTINCT FROM p_revision_id OR prior.play_style<>p_play_style OR prior.policy_id<>p_policy_id OR prior.parser_version<>p_parser_version OR prior.scoring_side<>p_scoring_side THEN RAISE EXCEPTION 'Result context conflicts' USING ERRCODE='22023'; END IF;
 RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.record_play_result_v2(uuid,text,bigint,numeric,integer,integer,integer,integer,integer,uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_play_result_v2(uuid,text,bigint,numeric,integer,integer,integer,integer,integer,uuid,text,text,text,text) TO authenticated;
CREATE TABLE public.growth_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity text NOT NULL,old_value jsonb,new_value jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.growth_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_audit_log FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.growth_audit_log TO service_role;
CREATE FUNCTION public.audit_xp_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.group_id<>NEW.group_id AND EXISTS(SELECT 1 FROM public.play_sessions WHERE revision_id=OLD.revision_id) THEN RAISE EXCEPTION 'Migrate first-clear and repeat identities before regrouping'; END IF;
 INSERT INTO public.growth_audit_log(entity,old_value,new_value) VALUES('xp_catalog',CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_xp_catalog() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER xp_catalog_audit BEFORE INSERT OR UPDATE ON public.xp_catalog FOR EACH ROW EXECUTE FUNCTION public.audit_xp_catalog();
