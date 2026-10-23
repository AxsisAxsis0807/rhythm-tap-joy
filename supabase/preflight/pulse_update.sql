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
