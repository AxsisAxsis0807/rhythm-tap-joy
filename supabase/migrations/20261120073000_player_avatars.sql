-- Public profile avatars are independent of unpublished song assets.
-- Do not change the legacy songs bucket or profile URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('player-avatars', 'player-avatars', true, 3145728, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'player-avatars' AND
      (public IS DISTINCT FROM true OR file_size_limit IS DISTINCT FROM 3145728::bigint
       OR allowed_mime_types IS DISTINCT FROM ARRAY['image/png'])
  ) THEN
    RAISE EXCEPTION 'Existing player-avatars bucket conflicts with avatar contract';
  END IF;
END $$;

CREATE POLICY "Players can upload their own new avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'player-avatars'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  AND name ~ '^[0-9a-f-]{36}/avatar-[0-9a-f-]{36}[.]png$'
);
-- Intentionally no UPDATE/DELETE policy: URLs are immutable and old files
-- remain available until a separately verified cleanup process is implemented.
