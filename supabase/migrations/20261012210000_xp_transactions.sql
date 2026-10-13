CREATE FUNCTION public.begin_verified_play(p_user_id uuid,p_nonce uuid,p_revision_id uuid,p_side text,p_configuration jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing public.play_sessions; catalog public.xp_catalog; revision public.chart_revisions; session public.play_sessions;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.xp_feature_flags WHERE name='xp_sessions' AND enabled) THEN
    RETURN jsonb_build_object('enabled',false,'sessionId',NULL,'expiresAt',NULL,'reason','xp_disabled');
  END IF;
  INSERT INTO public.player_progress(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.player_progress WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO existing FROM public.play_sessions WHERE user_id=p_user_id AND request_nonce=p_nonce;
  IF FOUND THEN
    IF existing.revision_id <> p_revision_id OR existing.side <> p_side OR existing.configuration <> p_configuration THEN
      RAISE EXCEPTION 'request nonce conflicts with original run' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('enabled',true,'sessionId',existing.id,'expiresAt',existing.expires_at,'status',existing.status);
  END IF;
  SELECT * INTO catalog FROM public.xp_catalog WHERE revision_id=p_revision_id AND side=p_side AND state='approved'
    AND effective_from <= now() AND (effective_until IS NULL OR effective_until > now());
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled',false,'sessionId',NULL,'expiresAt',NULL,'reason','revision_not_approved'); END IF;
  SELECT r.* INTO revision FROM public.chart_revisions r JOIN public.songs s ON s.id=r.song_id
    WHERE r.id=p_revision_id AND s.is_published;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled',false,'sessionId',NULL,'expiresAt',NULL,'reason','revision_not_public'); END IF;
  IF p_configuration->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_configuration->>'chartParserVersion' IS DISTINCT FROM revision.parser_version
    OR p_configuration->>'songId' IS DISTINCT FROM revision.song_id::text
    OR p_configuration->>'scoreRulesVersion' IS DISTINCT FROM catalog.score_rules_version
    OR NOT ((p_configuration->>'judgementPolicyId') = ANY(catalog.allowed_policies))
    OR (p_configuration->>'rate')::numeric IS DISTINCT FROM 1
    OR (p_configuration->>'practice')::boolean IS DISTINCT FROM false
    OR (p_configuration->>'autoplay')::boolean IS DISTINCT FROM false
    OR (p_configuration->>'assist')::boolean IS DISTINCT FROM false
    OR (p_configuration->>'competitive')::boolean IS DISTINCT FROM true
    OR abs((p_configuration->>'timingOffsetMs')::numeric) > 500
    OR coalesce(revision.fnf_side,'single') <> p_side
    OR (CASE WHEN p_configuration->>'scoringSide'='shared' THEN 'single' ELSE p_configuration->>'scoringSide' END) IS DISTINCT FROM p_side
  THEN RETURN jsonb_build_object('enabled',false,'sessionId',NULL,'expiresAt',NULL,'reason','configuration_ineligible'); END IF;
  -- Bounded issuance. Retries above remain idempotent and do not consume this budget.
  IF (SELECT count(*) FROM public.play_sessions WHERE user_id=p_user_id AND issued_at > now()-interval '1 hour') >= 120 THEN
    RAISE EXCEPTION 'XP session rate limit exceeded' USING ERRCODE='54000';
  END IF;
  UPDATE public.play_sessions SET status='superseded' WHERE user_id=p_user_id AND status='active';
  INSERT INTO public.play_sessions(user_id,request_nonce,revision_id,side,group_id,configuration,catalog_snapshot)
    VALUES(p_user_id,p_nonce,p_revision_id,p_side,catalog.group_id,p_configuration,
      jsonb_build_object('catalog',to_jsonb(catalog),'revision',to_jsonb(revision))) RETURNING * INTO session;
  RETURN jsonb_build_object('enabled',true,'sessionId',session.id,'expiresAt',session.expires_at);
END $$;

CREATE FUNCTION public.accept_play_evidence(p_user_id uuid,p_session_id uuid,p_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE session public.play_sessions; receipt jsonb;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_payload IS NULL OR octet_length(p_payload::text)>8388608 THEN
    RAISE EXCEPTION 'Invalid replay envelope' USING ERRCODE='22023';
  END IF;
  -- Every mutating XP path locks user progress before the session.
  PERFORM 1 FROM public.player_progress WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO session FROM public.play_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR session.user_id<>p_user_id THEN RAISE EXCEPTION 'Unknown play session' USING ERRCODE='42501'; END IF;
  IF session.finish_hash IS NOT NULL THEN
    IF session.finish_hash<>p_hash THEN RAISE EXCEPTION 'finish payload conflicts' USING ERRCODE='23505'; END IF;
    SELECT r.receipt INTO receipt FROM public.xp_receipts r WHERE r.session_id=p_session_id;
    RETURN jsonb_build_object('sessionId',p_session_id,'outcome',coalesce(receipt,jsonb_build_object('status','pending')));
  END IF;
  IF session.status<>'active' OR session.expires_at<now() THEN RAISE EXCEPTION 'Play session expired or superseded' USING ERRCODE='22023'; END IF;
  IF p_payload->>'runId' IS DISTINCT FROM p_session_id::text OR p_payload->'configuration' IS DISTINCT FROM session.configuration THEN
    RAISE EXCEPTION 'Replay configuration conflicts with START snapshot' USING ERRCODE='23505';
  END IF;
  UPDATE public.play_sessions SET finish_hash=p_hash,reward_date=(now() AT TIME ZONE 'UTC')::date,accepted_at=now(),status='accepted' WHERE id=p_session_id;
  INSERT INTO public.play_evidence(session_id,payload,payload_hash) VALUES(p_session_id,p_payload,p_hash);
  INSERT INTO public.verification_jobs(session_id) VALUES(p_session_id);
  RETURN jsonb_build_object('sessionId',p_session_id,'outcome',jsonb_build_object('status','pending'));
END $$;

CREATE FUNCTION public.finalize_verified_play(p_session_id uuid,p_hash text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE session public.play_sessions; owner uuid; old_total bigint; new_total bigint; receipt jsonb;
  day public.xp_daily; repeat public.xp_group_daily; first_clear boolean; daily_requested integer;
  first_requested integer; play_requested integer; daily_awarded integer; first_awarded integer; play_awarded integer;
  remaining integer; denominator integer; counted integer; visible boolean; eligible boolean; reason text;
BEGIN
  SELECT user_id INTO owner FROM public.play_sessions WHERE id=p_session_id;
  IF owner IS NULL THEN RAISE EXCEPTION 'Unknown play session'; END IF;
  SELECT total_xp INTO old_total FROM public.player_progress WHERE user_id=owner FOR UPDATE;
  SELECT * INTO session FROM public.play_sessions WHERE id=p_session_id FOR UPDATE;
  IF session.finish_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Verification hash conflicts' USING ERRCODE='23505'; END IF;
  SELECT r.receipt INTO receipt FROM public.xp_receipts r WHERE r.session_id=p_session_id;
  IF FOUND THEN RETURN jsonb_build_object('sessionId',p_session_id,'outcome',receipt); END IF;
  IF session.status<>'accepted' THEN RAISE EXCEPTION 'Finish must be durably accepted first'; END IF;
  -- Preserve accepted jobs during operational pauses; do not manufacture zero-XP receipts.
  IF NOT EXISTS (SELECT 1 FROM public.xp_feature_flags WHERE name='xp_awards' AND enabled) THEN
    RETURN jsonb_build_object('sessionId',p_session_id,'outcome',jsonb_build_object('status','pending'));
  END IF;
  eligible := (p_result->>'eligible')::boolean;
  counted := (p_result->>'countedMs')::integer;
  reason := p_result->>'reason';
  IF eligible IS NULL OR counted IS NULL OR counted NOT BETWEEN 0 AND 600000 THEN RAISE EXCEPTION 'Invalid verified result'; END IF;
  IF EXISTS (SELECT 1 FROM public.xp_catalog WHERE revision_id=session.revision_id AND side=session.side AND state='revoked') THEN eligible:=false; reason:='catalog_revoked'; END IF;
  IF eligible AND ((NOT p_result ?& ARRAY['headCount','successfulHeads','chartActiveMs']) OR (p_result->>'headCount')::integer < 20 OR (p_result->>'successfulHeads')::integer < 10
    OR (p_result->>'successfulHeads')::integer*2 < (p_result->>'headCount')::integer OR counted<30000
    OR (p_result->>'chartActiveMs')::integer<45000 OR (session.catalog_snapshot->'revision'->>'duration_ms')::integer<45000) THEN
    RAISE EXCEPTION 'Verified eligibility contradicts activity limits';
  END IF;
  INSERT INTO public.verified_plays(session_id,verified_result,eligible,reason) VALUES(p_session_id,p_result,eligible,reason);
  IF NOT eligible THEN
    receipt := jsonb_build_object('status','ineligible','reason',coalesce(reason,'verification_failed'));
  ELSE
    INSERT INTO public.xp_daily(user_id,reward_date) VALUES(owner,session.reward_date) ON CONFLICT DO NOTHING;
    SELECT * INTO day FROM public.xp_daily WHERE user_id=owner AND reward_date=session.reward_date FOR UPDATE;
    INSERT INTO public.xp_group_daily(user_id,group_id,reward_date) VALUES(owner,session.group_id,session.reward_date) ON CONFLICT DO NOTHING;
    SELECT * INTO repeat FROM public.xp_group_daily WHERE user_id=owner AND group_id=session.group_id AND reward_date=session.reward_date FOR UPDATE;
    PERFORM 1 FROM public.xp_first_clears WHERE user_id=owner AND group_id=session.group_id FOR UPDATE;
    first_clear := NOT FOUND;
    repeat.completions := repeat.completions+1;
    denominator := CASE WHEN repeat.completions<=5 THEN 1 WHEN repeat.completions<=10 THEN 2 ELSE 4 END;
    daily_requested := CASE WHEN day.daily_bonus_consumed THEN 0 ELSE 50 END;
    first_requested := CASE WHEN first_clear THEN 50 ELSE 0 END;
    play_requested := (counted::bigint*30/(60000*denominator))::integer;
    remaining := 1500-day.awarded_total;
    daily_awarded := least(daily_requested,remaining); remaining:=remaining-daily_awarded;
    first_awarded := least(first_requested,remaining); remaining:=remaining-first_awarded;
    play_awarded := least(play_requested,remaining);
    INSERT INTO public.xp_ledger(user_id,session_id,reward_type,amount,rule_version,reward_date) VALUES
      (owner,p_session_id,'daily_bonus',daily_awarded,session.rule_version,session.reward_date),
      (owner,p_session_id,'first_clear_bonus',first_awarded,session.rule_version,session.reward_date),
      (owner,p_session_id,'play',play_awarded,session.rule_version,session.reward_date);
    new_total := old_total+daily_awarded+first_awarded+play_awarded;
    UPDATE public.player_progress SET total_xp=new_total,version=version+1,updated_at=now() WHERE user_id=owner;
    UPDATE public.xp_daily SET awarded_total=awarded_total+daily_awarded+first_awarded+play_awarded,daily_bonus_consumed=true WHERE user_id=owner AND reward_date=session.reward_date;
    UPDATE public.xp_group_daily SET completions=repeat.completions WHERE user_id=owner AND group_id=session.group_id AND reward_date=session.reward_date;
    IF first_clear THEN INSERT INTO public.xp_first_clears(user_id,group_id,first_session,bonus_awarded) VALUES(owner,session.group_id,p_session_id,first_awarded); END IF;
    SELECT level_public INTO visible FROM public.profile_preferences WHERE user_id=owner;
    receipt := jsonb_build_object('status','awarded','receiptId',p_session_id,'earnedXp',(new_total-old_total)::text,
      'previousLevel',public.xp_growth_snapshot(old_total)->>'level','growth',public.xp_growth_snapshot(new_total,coalesce(visible,true)),
      'rewardDate',session.reward_date,'completionNumber',repeat.completions,'repeatDenominator',denominator,
      'breakdown',jsonb_build_array(
        jsonb_build_object('label','今日の初回','xp',daily_awarded::text,'requestedXp',daily_requested::text,'cappedXp',(daily_requested-daily_awarded)::text),
        jsonb_build_object('label','初クリア','xp',first_awarded::text,'requestedXp',first_requested::text,'cappedXp',(first_requested-first_awarded)::text),
        jsonb_build_object('label','プレイ','xp',play_awarded::text,'requestedXp',play_requested::text,'cappedXp',(play_requested-play_awarded)::text)));
  END IF;
  INSERT INTO public.xp_receipts(session_id,user_id,receipt) VALUES(p_session_id,owner,receipt);
  UPDATE public.play_sessions SET status=CASE WHEN eligible THEN 'completed' ELSE 'ineligible' END WHERE id=p_session_id;
  UPDATE public.verification_jobs SET status='completed',leased_until=NULL,updated_at=now() WHERE session_id=p_session_id;
  UPDATE public.play_evidence SET purge_after=now()+interval '30 days' WHERE session_id=p_session_id;
  RETURN jsonb_build_object('sessionId',p_session_id,'outcome',receipt);
END $$;

CREATE FUNCTION public.correct_xp_ledger(p_correction_id uuid,p_source_id uuid,p_amount bigint,p_reason text,p_operator uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE source public.xp_ledger; prior public.xp_ledger; total bigint; result uuid;
BEGIN
  SELECT * INTO source FROM public.xp_ledger WHERE id=p_source_id;
  IF NOT FOUND OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 OR p_operator IS NULL THEN RAISE EXCEPTION 'Audited correction required'; END IF;
  SELECT total_xp INTO total FROM public.player_progress WHERE user_id=source.user_id FOR UPDATE;
  SELECT * INTO prior FROM public.xp_ledger WHERE correction_id=p_correction_id;
  IF FOUND THEN
    IF prior.source_id<>p_source_id OR prior.amount<>p_amount OR prior.reason<>p_reason OR prior.operator_id<>p_operator THEN RAISE EXCEPTION 'Correction conflicts' USING ERRCODE='23505'; END IF;
    RETURN prior.id;
  END IF;
  IF total::numeric+p_amount < 0 OR total::numeric+p_amount > 9223372036854775807 THEN RAISE EXCEPTION 'Correction exceeds XP bounds'; END IF;
  INSERT INTO public.xp_ledger(user_id,reward_type,amount,rule_version,reward_date,source_id,correction_id,reason,operator_id)
    VALUES(source.user_id,'correction',p_amount,source.rule_version,(now() AT TIME ZONE 'UTC')::date,p_source_id,p_correction_id,p_reason,p_operator) RETURNING id INTO result;
  UPDATE public.player_progress SET total_xp=total_xp+p_amount,version=version+1,updated_at=now() WHERE user_id=source.user_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.begin_verified_play(uuid,uuid,uuid,text,jsonb),public.accept_play_evidence(uuid,uuid,text,jsonb),public.finalize_verified_play(uuid,text,jsonb),public.correct_xp_ledger(uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_verified_play(uuid,uuid,uuid,text,jsonb),public.accept_play_evidence(uuid,uuid,text,jsonb),public.finalize_verified_play(uuid,text,jsonb),public.correct_xp_ledger(uuid,uuid,bigint,text,uuid) TO service_role;
