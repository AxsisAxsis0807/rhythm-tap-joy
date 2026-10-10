/** Destructive fixture initialization ONLY in disposable localhost DB. Does not use
 * SUPABASE_URL/DATABASE_URL and refuses non-loopback hosts. Run in a fresh container. */
import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const url = new URL(
  process.env.PULSE_TEST_DB_URL ?? "postgres://postgres@127.0.0.1:55432/postgres",
);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Disposable loopback test DB required");
const sql = postgres(url.toString(), { max: 5 });
try {
  await sql.unsafe(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE storage.objects(bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;`);
  for (const file of (await readdir("supabase/migrations")).sort())
    await sql.unsafe(await readFile(`supabase/migrations/${file}`, "utf8"));
  const user = randomUUID(),
    revision = "a".repeat(64),
    digest = "b".repeat(64);
  await sql`INSERT INTO auth.users VALUES(${user},'local@invalid',${sql.json({ username: "local" })})`;
  await sql`INSERT INTO public.chart_revisions(digest,song_id,chart,audio_duration,approved) VALUES(${revision},'verified','{}',2,true)`;
  await sql`UPDATE public.xp_policy SET enabled=true`;
  async function run() {
    return sql.begin(async (tx) => {
      await tx`SELECT set_config('request.jwt.claim.sub',${user},true)`;
      await tx`SET LOCAL ROLE authenticated`;
      const play = randomUUID();
      const [s] = await tx`SELECT public.begin_verified_play(${play},${revision},0) AS value`;
      await tx`SELECT public.record_play_result(${play},'verified',1002,100,1,1,0,0,0)`;
      return s.value.sessionId;
    });
  }
  const session = await run(),
    payload = {
      score: "1002",
      accuracy: 100,
      maxCombo: "1",
      perfect: "1",
      great: "0",
      good: "0",
      miss: "0",
      elapsedMs: 0,
    };
  async function award(id) {
    return sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      const [r] =
        await tx`SELECT public.commit_verified_xp(${id},${digest},${tx.json(payload)}) AS reward`;
      await tx`SELECT pg_sleep(0.15)`;
      return r.reward;
    });
  }
  const same = await Promise.all(Array.from({ length: 5 }, () => award(session)));
  assert(same.every((r) => r.earnedXp === "190"));
  const [ledger] = await sql`SELECT count(*)::int AS count FROM public.xp_ledger`;
  assert.equal(ledger.count, 1);
  const sessions = [await run(), await run()];
  const different = await Promise.all(sessions.map(award));
  assert.deepEqual(different.map((r) => r.earnedXp).sort(), ["22", "45"]);
  const [progress] =
    await sql`SELECT total_xp::text AS xp FROM public.xp_progress WHERE user_id=${user}`;
  assert.equal(progress.xp, "257");
  const [score] =
    await sql`SELECT total_score::text AS score,play_count::text AS plays FROM public.player_stats WHERE user_id=${user}`;
  assert.deepEqual(score, { score: "3006", plays: "3" });
  const cappedOwner = randomUUID(),
    cappedPlay = randomUUID();
  await sql`INSERT INTO auth.users VALUES(${cappedOwner}, 'capped@invalid', ${sql.json({ username: "capped" })})`;
  await sql`INSERT INTO public.verified_play_sessions(play_id,user_id,revision,timing_offset_ms)
    SELECT gen_random_uuid(),${cappedOwner},${revision},0 FROM generate_series(1,119)`;
  const duplicateSessions = await Promise.all(
    [0, 1].map(() =>
      sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claim.sub',${cappedOwner},true)`;
        await tx`SET LOCAL ROLE authenticated`;
        const [value] =
          await tx`SELECT public.begin_verified_play(${cappedPlay},${revision},0) AS session`;
        await tx`SELECT pg_sleep(0.15)`;
        return value.session;
      }),
    ),
  );
  assert(duplicateSessions[0].sessionId);
  assert.equal(duplicateSessions[0].sessionId, duplicateSessions[1].sessionId);
  console.log(
    "PASS PostgreSQL 17: all migrations, 5 overlapping duplicate transactions, competing repeat/bonus awards, ledger=3 XP=257 SCORE=3006 PLAYS=3; Session retries at issuance cap remain idempotent",
  );
} finally {
  await sql.end();
}
