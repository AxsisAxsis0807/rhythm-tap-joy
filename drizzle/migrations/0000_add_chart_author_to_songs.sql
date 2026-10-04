ALTER TABLE public.songs ADD COLUMN chart_author text NOT NULL DEFAULT '';
COMMENT ON COLUMN public.songs.chart_author IS 'Name of the chart creator, separate from the song artist';