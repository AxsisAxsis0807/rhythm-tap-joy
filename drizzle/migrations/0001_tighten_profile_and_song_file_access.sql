DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Own or published-creator profiles are viewable" ON public.profiles FOR SELECT
USING (auth.uid() = id OR EXISTS (SELECT 1 FROM public.songs s WHERE s.user_id = profiles.id AND s.is_published = true));

CREATE OR REPLACE FUNCTION public.username_available(_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = lower(_username)) $$;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view song files" ON storage.objects;
CREATE POLICY "Owners and published song files are viewable" ON storage.objects FOR SELECT
USING (
  bucket_id = 'songs' AND (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM public.songs s WHERE s.is_published = true
      AND objects.name IN (s.audio_path, s.chart_path, s.cover_path, s.background_path, s.player_image_path, s.opponent_image_path)
    )
  )
);