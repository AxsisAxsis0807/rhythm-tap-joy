-- Read-only staging/production inventory. Contains no user data or secret values.
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('songs','profiles','player_stats','play_results') ORDER BY table_name,ordinal_position;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','storage');
SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema IN ('public','storage') AND grantee IN ('anon','authenticated','service_role');
SELECT routine_name,grantee,privilege_type FROM information_schema.routine_privileges
WHERE routine_schema='public' AND grantee IN ('PUBLIC','anon','authenticated','service_role');
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id;

-- Song Settings inventory: run with a read-only administrator connection.
SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('chart_revisions','song_edit_operations','song_revision_candidates','song_edit_objects','image_reservations','image_assets','asset_cleanup_jobs','song_settings_gates')
ORDER BY table_name,ordinal_position;
SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage') ORDER BY n.nspname,c.relname,t.tgname;
SELECT singleton,schema_version,settings_enabled,background_enabled,timing_enabled FROM public.song_settings_gates;
SELECT public.song_settings_schema_ready() AS song_settings_schema_ready;
-- Operational counts only; do not output paths, user IDs, tokens or content.
SELECT bucket_id,count(*) AS jobs,count(*) FILTER (WHERE dead_letter_at IS NOT NULL) AS dead_letters,
 min(not_before) FILTER (WHERE completed_at IS NULL) AS oldest_pending FROM public.asset_cleanup_jobs GROUP BY bucket_id;
