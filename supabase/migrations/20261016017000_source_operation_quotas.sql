-- Serialize per-owner reservations, including concurrent tabs. Retries reuse a row.
CREATE FUNCTION public.limit_song_source_operations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind='save' THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.owner_id::text,160170));
  IF (SELECT count(*) FROM public.song_edit_operations WHERE owner_id=NEW.owner_id AND kind<>'save' AND state IN ('preparing','prepared') AND expires_at>now())>=3
    OR (SELECT count(*) FROM public.song_edit_operations WHERE owner_id=NEW.owner_id AND kind<>'save' AND created_at>now()-interval '1 hour')>=8
    OR (SELECT count(*) FROM public.song_edit_operations WHERE owner_id=NEW.owner_id AND kind<>'save' AND created_at>now()-interval '24 hours')>=24 THEN
    RAISE EXCEPTION 'Source preparation quota reached; retry later' USING ERRCODE='54000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.limit_song_source_operations() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER song_source_operation_quota BEFORE INSERT ON public.song_edit_operations
FOR EACH ROW EXECUTE FUNCTION public.limit_song_source_operations();
