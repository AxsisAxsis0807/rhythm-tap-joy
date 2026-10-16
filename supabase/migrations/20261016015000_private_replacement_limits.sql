ALTER TABLE public.song_edit_objects ADD COLUMN max_bytes integer CHECK(max_bytes BETWEEN 1 AND 104857600);
CREATE FUNCTION public.limit_private_candidate_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ceiling integer;
BEGIN
  IF NEW.bucket_id='chart-revision-assets' THEN
    SELECT max_bytes INTO ceiling FROM public.song_edit_objects WHERE path=NEW.name;
    IF ceiling IS NOT NULL AND coalesce((NEW.metadata->>'size')::bigint,0)>ceiling THEN
      RAISE EXCEPTION 'Candidate exceeds its reserved byte limit' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.limit_private_candidate_upload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER private_candidate_upload_limit BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.limit_private_candidate_upload();
