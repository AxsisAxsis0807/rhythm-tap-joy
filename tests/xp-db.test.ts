// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
const db = new PGlite();
const users = [randomUUID(), randomUUID()];
const revision = "a".repeat(64),
  digest = "b".repeat(64);
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE storage.objects(bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const [i, id] of users.entries())
    await db.query("INSERT INTO auth.users VALUES($1,$2,$3)", [
      id,
      `xp${i}@test.invalid`,
      JSON.stringify({ username: `xp${i}` }),
    ]);
  await db.query(
    "INSERT INTO public.chart_revisions(digest,song_id,chart,audio_duration,approved) VALUES($1,'verified','{}',2,true)",
    [revision],
  );
}, 30000);
afterAll(() => db.close());
async function role<T>(name: string, id: string | null, fn: () => Promise<T>) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec(`SET ROLE ${name}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function enabled(value = true) {
  await db.query("UPDATE public.xp_policy SET enabled=$1", [value]);
}
async function start(user: string, rev = revision, play = randomUUID()) {
  const { rows } = await role("authenticated", user, () =>
    db.query<{ session: { sessionId: string; reason?: string } }>(
      "SELECT public.begin_verified_play($1,$2,0) AS session",
      [play, rev],
    ),
  );
  return { play, session: rows[0]!.session };
}
async function save(user: string, play: string) {
  await role("authenticated", user, () =>
    db.query("SELECT public.record_play_result($1,'verified',1002,100,1,1,0,0,0)", [play]),
  );
}
const verified = {
  score: "1002",
  accuracy: 100,
  maxCombo: "1",
  perfect: "1",
  great: "0",
  good: "0",
  miss: "0",
  elapsedMs: 0,
};
async function award(session: string, payload = verified, hash = digest) {
  return (
    await role("service_role", null, () =>
      db.query<{ reward: Record<string, unknown> }>(
        "SELECT public.commit_verified_xp($1,$2,$3) AS reward",
        [session, hash, payload],
      ),
    )
  ).rows[0]!.reward;
}
it("default publication OFF, unreviewed/unknown revision cannot issue sessions and client cannot approve", async () => {
  expect((await start(users[0]!)).session.reason).toBe("disabled");
  await enabled();
  expect((await start(users[0]!, "c".repeat(64))).session.reason).toBe("unreviewed");
  await role("authenticated", users[0]!, async () => {
    await expect(db.exec("UPDATE public.chart_revisions SET approved=true")).rejects.toThrow();
    await expect(db.exec("UPDATE public.xp_policy SET enabled=true")).rejects.toThrow();
  });
});
it("session UUID is server issued and bound to owner, play ID and immutable options", async () => {
  const first = await start(users[0]!);
  const same = await start(users[0]!, revision, first.play);
  expect(same.session.sessionId).toBe(first.session.sessionId);
  await expect(start(users[1]!, revision, first.play)).rejects.toThrow("Session conflict");
  await role("authenticated", users[0]!, async () => {
    await expect(
      db.query("SELECT public.begin_verified_play($1,$2,301)", [randomUUID(), revision]),
    ).rejects.toThrow();
    await expect(
      db.exec(
        "INSERT INTO public.verified_play_sessions(play_id,user_id,revision,timing_offset_ms) VALUES(gen_random_uuid(),auth.uid(),'a',0)",
      ),
    ).rejects.toThrow();
  });
  await expect(db.exec("UPDATE public.chart_revisions SET audio_duration=9")).rejects.toThrow(
    "immutable",
  );
});
it("retry and parallel invocations return the same reward; first/daily/repeat arithmetic and score stay independent", async () => {
  const run = await start(users[0]!);
  await save(users[0]!, run.play);
  const one = await award(run.session.sessionId);
  const two = await award(run.session.sessionId);
  expect(two).toEqual(one);
  expect(one.earnedXp).toBe("190");
  // PGlite serializes statements. Unique keys and FOR UPDATE are exercised here;
  // a separate real-Postgres runner tests overlapping transactions.
  const results = await role("service_role", null, () =>
    Promise.all([
      db.query<{ reward: Record<string, unknown> }>(
        "SELECT public.commit_verified_xp($1,$2,$3) AS reward",
        [run.session.sessionId, digest, verified],
      ),
      db.query<{ reward: Record<string, unknown> }>(
        "SELECT public.commit_verified_xp($1,$2,$3) AS reward",
        [run.session.sessionId, digest, verified],
      ),
    ]).then((results) => results.map((r) => r.rows[0]!.reward)),
  );
  expect(results).toEqual([one, one]);
  for (const expected of ["45", "22"]) {
    const next = await start(users[0]!);
    await save(users[0]!, next.play);
    expect((await award(next.session.sessionId)).earnedXp).toBe(expected);
  }
  const limit = await start(users[0]!);
  await save(users[0]!, limit.play);
  expect(await award(limit.session.sessionId)).toEqual({
    status: "ineligible",
    reason: "repeat_limit",
  });
  expect(
    (
      await db.query<{ xp: number }>(
        "SELECT total_xp AS xp FROM public.xp_progress WHERE user_id=$1",
        [users[0]],
      )
    ).rows[0]!.xp,
  ).toBe(257);
  expect(
    (await db.query("SELECT * FROM public.player_stats WHERE user_id=$1", [users[0]])).rows[0],
  ).toMatchObject({ total_score: 4008, play_count: 4 });
});
it("client arbitrary XP/level/rewards/session changes and other's private reads are rejected", async () => {
  await role("authenticated", users[1]!, async () => {
    for (const table of [
      "xp_progress",
      "xp_ledger",
      "verified_play_sessions",
      "supporter_entitlements",
      "account_visibility",
    ]) {
      expect(
        (await db.query(`SELECT * FROM public.${table} WHERE user_id=$1`, [users[0]])).rows,
      ).toEqual([]);
      await expect(db.exec(`DELETE FROM public.${table}`)).rejects.toThrow();
    }
    await expect(db.exec("UPDATE public.xp_progress SET total_xp=999999")).rejects.toThrow();
    await expect(
      db.query("SELECT public.commit_verified_xp(gen_random_uuid(),$1,$2)", [digest, verified]),
    ).rejects.toThrow();
    await expect(
      db.exec("INSERT INTO public.xp_progress VALUES(auth.uid(),999)"),
    ).rejects.toThrow();
    await expect(
      db.exec(
        "INSERT INTO public.supporter_entitlements VALUES(auth.uid(),'Supporter','fake',now()+interval '1 year')",
      ),
    ).rejects.toThrow();
  });
});
it("settings persist across owner sessions; public API and direct tables cannot leak hidden fields", async () => {
  await db.query(
    "INSERT INTO public.supporter_entitlements VALUES($1,'Supporter','Tier 1',now()+interval '1 day')",
    [users[0]],
  );
  await role("authenticated", users[0]!, () =>
    db.exec("SELECT public.set_account_visibility(false,false,false)"),
  );
  await role("anon", null, async () => {
    expect(
      (
        await db.query<{ g: object }>("SELECT public.get_public_account_growth($1) AS g", [
          users[0],
        ])
      ).rows[0]!.g,
    ).toEqual({});
    for (const table of [
      "xp_progress",
      "account_visibility",
      "supporter_entitlements",
      "xp_ledger",
      "verified_play_sessions",
    ])
      await expect(db.exec(`SELECT * FROM public.${table}`)).rejects.toThrow();
  });
  const owner = await role("authenticated", users[0]!, () =>
    db.query<{ g: { visibility: object; growth: { totalXp: string }; supporter: object } }>(
      "SELECT public.get_account_growth() AS g",
    ),
  );
  expect(owner.rows[0]!.g.visibility).toEqual({
    levelPublic: false,
    xpPublic: false,
    supporterPublic: false,
  });
  expect(owner.rows[0]!.g.growth.totalXp).toBe("257");
  expect(owner.rows[0]!.g.supporter).not.toBeNull();
  await role("authenticated", users[1]!, () =>
    db.exec("SELECT public.set_account_visibility(true,true,true)"),
  );
  expect(
    (
      await db.query("SELECT level_public FROM public.account_visibility WHERE user_id=$1", [
        users[0],
      ])
    ).rows[0]!.level_public,
  ).toBe(false);
  await role("authenticated", users[0]!, () =>
    db.exec("SELECT public.set_account_visibility(true,false,false)"),
  );
  const publicLevel = await role("anon", null, () =>
    db.query<{ g: object }>("SELECT public.get_public_account_growth($1) AS g", [users[0]]),
  );
  expect(publicLevel.rows[0]!.g).toEqual({ level: "1" });
});
it("XP failure, expiry, wall-clock abuse and score mismatch cannot change saved TOTAL SCORE", async () => {
  const run = await start(users[1]!);
  await save(users[1]!, run.play);
  await expect(award(run.session.sessionId, { ...verified, score: "9999" })).rejects.toThrow();
  await expect(award(run.session.sessionId, { ...verified, accuracy: 99 })).rejects.toThrow();
  expect((await award(run.session.sessionId, { ...verified, elapsedMs: 999999999 })).reason).toBe(
    "elapsed",
  );
  const expired = await start(users[1]!);
  await save(users[1]!, expired.play);
  await db.query(
    "UPDATE public.verified_play_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [expired.session.sessionId],
  );
  expect((await award(expired.session.sessionId)).reason).toBe("expired");
  expect(
    (await db.query("SELECT * FROM public.player_stats WHERE user_id=$1", [users[1]])).rows[0],
  ).toMatchObject({ total_score: 2004, play_count: 2 });
});
it("day cap includes bonuses and level snapshots cover exact/multiple thresholds and BIGINT", async () => {
  await db.query("UPDATE public.xp_progress SET total_xp=499 WHERE user_id=$1", [users[1]]);
  await db.exec("UPDATE public.xp_policy SET daily_cap=1");
  const run = await start(users[1]!);
  await save(users[1]!, run.play);
  const outcome = await award(run.session.sessionId);
  expect(outcome.earnedXp).toBe("1");
  expect(outcome.growth).toMatchObject({ level: "2", xpInLevel: "0", totalXp: "500" });
  const capped = await start(users[1]!);
  await save(users[1]!, capped.play);
  expect((await award(capped.session.sessionId)).reason).toBe("daily_cap");
  await db.exec("UPDATE public.xp_policy SET daily_cap=100000,play_xp=2000");
  const newRev = "d".repeat(64);
  await db.query(
    "INSERT INTO public.chart_revisions(digest,song_id,chart,audio_duration,approved) VALUES($1,'verified','{}',2,true)",
    [newRev],
  );
  const multi = await start(users[1]!, newRev);
  await save(users[1]!, multi.play);
  expect((await award(multi.session.sessionId)).growth).toMatchObject({
    level: "6",
    totalXp: "2550",
    xpInLevel: "50",
  });
  await db.query("UPDATE public.xp_progress SET total_xp=9007199254740993 WHERE user_id=$1", [
    users[1],
  ]);
  const g = await role("authenticated", users[1]!, () =>
    db.query<{ g: { growth: { totalXp: string } } }>("SELECT public.get_account_growth() AS g"),
  );
  expect(g.rows[0]!.g.growth.totalXp).toBe("9007199254740993");
});
it("free and real Supporter entitlement have identical score/accuracy/total calculations", async () => {
  await db.exec("UPDATE public.xp_policy SET play_xp=90,daily_cap=1000");
  const third = randomUUID(),
    fourth = randomUUID();
  for (const id of [third, fourth])
    await db.query("INSERT INTO auth.users VALUES($1,$2,$3)", [
      id,
      id + "@test.invalid",
      JSON.stringify({ username: id }),
    ]);
  await db.query(
    "INSERT INTO public.supporter_entitlements VALUES($1,'Supporter','Tier 2',now()+interval '1 day')",
    [fourth],
  );
  const a = await start(third),
    b = await start(fourth);
  await save(third, a.play);
  await save(fourth, b.play);
  expect(await award(a.session.sessionId)).toEqual(await award(b.session.sessionId));
  const stats = await db.query(
    "SELECT total_score,play_count FROM public.player_stats WHERE user_id IN($1,$2)",
    [third, fourth],
  );
  expect(stats.rows).toEqual([
    { total_score: 1002, play_count: 1 },
    { total_score: 1002, play_count: 1 },
  ]);
  const scores = await db.query(
    "SELECT score,accuracy FROM public.play_results WHERE id IN($1,$2)",
    [a.play, b.play],
  );
  expect(scores.rows).toEqual([
    { score: 1002, accuracy: "100" },
    { score: 1002, accuracy: "100" },
  ]);
});

it("XP publication cannot reveal a private Level through mathematically equivalent total XP", async () => {
  await role("authenticated", users[0]!, () =>
    db.exec("SELECT public.set_account_visibility(false,true,false)"),
  );
  const value = await role("anon", null, () =>
    db.query<{ g: object }>("SELECT public.get_public_account_growth($1) AS g", [users[0]]),
  );
  expect(value.rows[0]!.g).toEqual({});
});
