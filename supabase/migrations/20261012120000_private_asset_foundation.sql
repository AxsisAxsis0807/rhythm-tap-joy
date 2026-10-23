-- Preserve the legacy songs bucket: avatars currently use public URLs there.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('asset-staging','asset-staging',false,3145728,ARRAY['image/jpeg','image/png','image/webp']),
  ('profile-card-images','profile-card-images',false,3145728,ARRAY['image/jpeg','image/webp']),
  ('chart-revision-assets','chart-revision-assets',false,104857600,ARRAY['application/json','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/mp4','audio/webm'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('asset-staging','profile-card-images','chart-revision-assets') AND public) THEN
    RAISE EXCEPTION 'A new asset bucket already exists as public; inspect and correct it before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'asset-staging' AND
    (file_size_limit IS DISTINCT FROM 3145728::bigint OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/png','image/webp'])) THEN
    RAISE EXCEPTION 'asset-staging bucket limits conflict with the verified upload contract';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'profile-card-images' AND
    (file_size_limit IS DISTINCT FROM 3145728::bigint OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/webp'])) OR
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chart-revision-assets' AND
    (file_size_limit IS DISTINCT FROM 104857600::bigint OR allowed_mime_types IS DISTINCT FROM ARRAY['application/json','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/mp4','audio/webm'])) THEN
    RAISE EXCEPTION 'Canonical asset bucket limits conflict; inspect before migration';
  END IF;
END; $$;

CREATE TABLE public.image_reservations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  purpose text NOT NULL CHECK (purpose IN ('profile-card','chart-cover','chart-background','chart-player','chart-opponent')),
  target_id uuid NOT NULL,
  path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  expected_bytes integer NOT NULL CHECK (expected_bytes BETWEEN 1 AND 3145728),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','verified','rejected','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  CHECK (path = owner_id::text || '/' || id::text || '/source')
);
CREATE INDEX image_reservations_owner_time ON public.image_reservations(owner_id, created_at);
ALTER TABLE public.image_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_reservations FROM anon, authenticated;
GRANT SELECT ON public.image_reservations TO authenticated;
GRANT ALL ON public.image_reservations TO service_role;
CREATE POLICY "Own image reservations" ON public.image_reservations FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE TABLE public.image_assets (
  id uuid PRIMARY KEY REFERENCES public.image_reservations(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  purpose text NOT NULL,
  target_id uuid NOT NULL,
  path text NOT NULL UNIQUE,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/webp')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 3145728),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (width::bigint * height <= 4194304),
  CHECK (path = owner_id::text || '/' || id::text || '/master')
);
ALTER TABLE public.image_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_assets FROM anon, authenticated;
GRANT SELECT ON public.image_assets TO authenticated;
GRANT ALL ON public.image_assets TO service_role;
CREATE POLICY "Own verified images" ON public.image_assets FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE TABLE public.profile_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_public boolean NOT NULL DEFAULT true,
  background_asset_id uuid REFERENCES public.image_assets(id),
  crop_x numeric NOT NULL DEFAULT 0.5 CHECK (crop_x BETWEEN 0 AND 1),
  crop_y numeric NOT NULL DEFAULT 0.5 CHECK (crop_y BETWEEN 0 AND 1),
  crop_zoom numeric NOT NULL DEFAULT 1 CHECK (crop_zoom BETWEEN 1 AND 3),
  metadata_version bigint NOT NULL DEFAULT 0 CHECK (metadata_version >= 0)
);
ALTER TABLE public.profile_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_preferences FROM anon, authenticated;
GRANT SELECT ON public.profile_preferences TO authenticated;
GRANT ALL ON public.profile_preferences TO service_role;
CREATE POLICY "Own profile preferences" ON public.profile_preferences FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE TABLE public.asset_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL CHECK (bucket_id IN ('asset-staging','profile-card-images')),
  path text NOT NULL,
  asset_id uuid,
  not_before timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  completed_at timestamptz,
  UNIQUE(bucket_id,path)
);
ALTER TABLE public.asset_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_cleanup_jobs FROM anon, authenticated;
GRANT ALL ON public.asset_cleanup_jobs TO service_role;

CREATE FUNCTION public.reserve_image_asset(p_id uuid, p_purpose text, p_target_id uuid, p_mime_type text, p_expected_bytes integer)
RETURNS public.image_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE reservation public.image_reservations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 76123));
  IF (p_purpose = 'profile-card' AND p_target_id <> auth.uid()) OR
    (p_purpose <> 'profile-card' AND NOT EXISTS (SELECT 1 FROM public.songs WHERE id = p_target_id AND user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Image target owner required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO reservation FROM public.image_reservations WHERE id = p_id;
  IF FOUND THEN
    IF reservation.owner_id <> auth.uid() OR reservation.purpose <> p_purpose OR reservation.target_id <> p_target_id
      OR reservation.mime_type <> p_mime_type OR reservation.expected_bytes <> p_expected_bytes THEN
      RAISE EXCEPTION 'Reservation conflicts with another payload' USING ERRCODE = '22023';
    END IF;
    RETURN reservation;
  END IF;
  IF (SELECT count(*) FROM public.image_reservations WHERE owner_id = auth.uid() AND state = 'reserved' AND expires_at > now()) >= 5
    OR (SELECT count(*) FROM public.image_reservations WHERE owner_id = auth.uid() AND created_at > now() - interval '1 hour') >= 20
    OR coalesce((SELECT sum(expected_bytes) FROM public.image_reservations WHERE owner_id = auth.uid() AND created_at > now() - interval '24 hours'),0) + p_expected_bytes > 104857600 THEN
    RAISE EXCEPTION 'Image upload quota reached; retry later' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.image_reservations (id,owner_id,purpose,target_id,path,mime_type,expected_bytes)
    VALUES (p_id,auth.uid(),p_purpose,p_target_id,auth.uid()::text || '/' || p_id::text || '/source',p_mime_type,p_expected_bytes)
    RETURNING * INTO reservation;
  INSERT INTO public.asset_cleanup_jobs(bucket_id,path) VALUES ('asset-staging',reservation.path);
  RETURN reservation;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_image_asset(uuid,text,uuid,text,integer) FROM PUBLIC, anon, authenticated;
-- Disabled until the server ImageProcessor target is validated. Grant to authenticated only as part of that gate.

CREATE FUNCTION public.save_profile_preferences(p_expected_version bigint,p_level_public boolean,p_crop_x numeric,p_crop_y numeric,p_crop_zoom numeric,p_remove_image boolean)
RETURNS public.profile_preferences LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE prefs public.profile_preferences; old_asset public.image_assets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.profile_preferences (user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT * INTO prefs FROM public.profile_preferences WHERE user_id = auth.uid() FOR UPDATE;
  IF prefs.metadata_version <> p_expected_version THEN RAISE EXCEPTION 'Profile preferences changed; reload before saving' USING ERRCODE = '40001'; END IF;
  IF p_level_public IS NULL OR p_crop_x IS NULL OR p_crop_y IS NULL OR p_crop_zoom IS NULL
    OR p_crop_x NOT BETWEEN 0 AND 1 OR p_crop_y NOT BETWEEN 0 AND 1 OR p_crop_zoom NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Invalid profile crop' USING ERRCODE = '22023';
  END IF;
  IF p_remove_image AND prefs.background_asset_id IS NOT NULL THEN
    SELECT * INTO old_asset FROM public.image_assets WHERE id = prefs.background_asset_id;
    INSERT INTO public.asset_cleanup_jobs(bucket_id,path,asset_id) VALUES ('profile-card-images',old_asset.path,old_asset.id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.profile_preferences SET level_public = p_level_public,
    background_asset_id = CASE WHEN p_remove_image THEN NULL ELSE background_asset_id END,
    crop_x = p_crop_x,crop_y = p_crop_y,crop_zoom = p_crop_zoom, metadata_version = metadata_version + 1
  WHERE user_id = auth.uid() RETURNING * INTO prefs;
  RETURN prefs;
END;
$$;
REVOKE ALL ON FUNCTION public.save_profile_preferences(bigint,boolean,numeric,numeric,numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_profile_preferences(bigint,boolean,numeric,numeric,numeric,boolean) TO authenticated;

CREATE POLICY "Reserved insert-only image uploads" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'asset-staging' AND EXISTS (SELECT 1 FROM public.image_reservations r
  WHERE r.path = name AND r.owner_id = (SELECT auth.uid()) AND r.state = 'reserved' AND r.expires_at > now()));
CREATE POLICY "Readable immutable revision files" ON storage.objects FOR SELECT
USING (bucket_id = 'chart-revision-assets' AND EXISTS (SELECT 1 FROM public.chart_revisions r JOIN public.songs s ON s.id = r.song_id
  WHERE (r.chart_path = name OR r.audio_path = name) AND (s.is_published OR s.user_id = (SELECT auth.uid()))));
CREATE POLICY "Own verified profile images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'profile-card-images' AND EXISTS (SELECT 1 FROM public.image_assets a JOIN public.profile_preferences p ON p.background_asset_id = a.id
  WHERE a.path = name AND a.owner_id = (SELECT auth.uid()) AND p.user_id = (SELECT auth.uid())));
-- Canonical image SELECT for public viewers goes through an explicit server projection.
CREATE FUNCTION public.protect_canonical_storage() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.bucket_id = 'chart-revision-assets' THEN
    RAISE EXCEPTION 'Canonical revision bytes are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_canonical_storage() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER canonical_storage_immutable BEFORE UPDATE OR DELETE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.protect_canonical_storage();
