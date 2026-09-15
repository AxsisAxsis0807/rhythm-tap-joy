CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.songs (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  difficulty_name TEXT NOT NULL DEFAULT 'NORMAL',
  bpm NUMERIC NOT NULL DEFAULT 60,
  offset_sec NUMERIC NOT NULL DEFAULT 0,
  lane_count INTEGER NOT NULL DEFAULT 4,
  note_count INTEGER NOT NULL DEFAULT 0,
  mode_id TEXT NOT NULL DEFAULT 'classic',
  audio_path TEXT,
  chart_path TEXT,
  cover_path TEXT,
  background_path TEXT,
  player_image_path TEXT,
  opponent_image_path TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX songs_user_id_idx ON public.songs (user_id);
CREATE INDEX songs_published_idx ON public.songs (is_published, published_at DESC);

GRANT SELECT ON public.songs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.songs TO authenticated;
GRANT ALL ON public.songs TO service_role;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published songs are viewable by everyone" ON public.songs FOR SELECT USING (is_published = true);
CREATE POLICY "Owners can view their own songs" ON public.songs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners can insert songs" ON public.songs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can update their songs" ON public.songs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can delete their songs" ON public.songs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER songs_set_updated_at BEFORE UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  final_name TEXT;
  suffix INTEGER := 0;
BEGIN
  base_name := lower(regexp_replace(coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1), 'player'), '[^a-z0-9_]', '', 'g'));
  IF base_name = '' THEN
    base_name := 'player';
  END IF;
  final_name := base_name;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_name) LOOP
    suffix := suffix + 1;
    final_name := base_name || suffix::text;
  END LOOP;
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id, final_name, coalesce(NEW.raw_user_meta_data->>'display_name', final_name));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "Anyone can view song files" ON storage.objects FOR SELECT USING (bucket_id = 'songs');
CREATE POLICY "Users can upload their own song files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can update their own song files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete their own song files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'songs' AND (storage.foldername(name))[1] = auth.uid()::text);