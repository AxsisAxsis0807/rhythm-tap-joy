ALTER TABLE public.songs
  ADD COLUMN chart_type text NOT NULL DEFAULT 'mania',
  ADD COLUMN fnf_side text NOT NULL DEFAULT 'right',
  ADD COLUMN is_official boolean NOT NULL DEFAULT false;

CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.validate_song()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.chart_type NOT IN ('mania','fnf') THEN RAISE EXCEPTION 'invalid chart_type'; END IF;
  IF NEW.fnf_side NOT IN ('left','right') THEN RAISE EXCEPTION 'invalid fnf_side'; END IF;
  IF NEW.is_official AND (TG_OP = 'INSERT' OR OLD.is_official IS DISTINCT FROM NEW.is_official)
     AND auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '正規版の投稿には管理者コードが必要です';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER songs_validate BEFORE INSERT OR UPDATE ON public.songs
FOR EACH ROW EXECUTE FUNCTION public.validate_song();