// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";

const db = new PGlite();
const users = [randomUUID(), randomUUID()];
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    CREATE TABLE storage.objects (bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
  `);
  for (const file of readdirSync("supabase/migrations").sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  for (const [i, id] of users.entries()) {
    await db.query("INSERT INTO auth.users VALUES ($1, $2, $3)", [
      id,
      `player${i}@test.invalid`,
      JSON.stringify({ username: `player${i}` }),
    ]);
  }
}, 30000);
afterAll(() => db.close());
async function asUser<T>(id: string, action: () => Promise<T>) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function record(id: string, score: number, song = "local-test", perfect = 1, maxCombo = 1) {
  return db.query<{ saved: boolean }>(
    "SELECT public.record_play_result($1, $2, $3, 100, $4, $5, 0, 0, 0) AS saved",
    [id, song, score, maxCombo, perfect],
  );
}
it("one and two completions aggregate; duplicate requests do not increment; RETRY increments", async () => {
  const id = randomUUID();
  await asUser(users[0]!, async () => {
    expect((await record(id, 1002)).rows[0]?.saved).toBe(true);
    expect(
      (
        await db.query<{ total_score: number }>(
          "SELECT total_score FROM public.player_stats WHERE user_id = auth.uid()",
        )
      ).rows[0]?.total_score,
    ).toBe(1002);
    expect((await record(id, 1002)).rows[0]?.saved).toBe(false);
    await record(randomUUID(), 1002, "second-song");
    let stats = (
      await db.query<{ total_score: number; play_count: number }>(
        "SELECT * FROM public.player_stats WHERE user_id = auth.uid()",
      )
    ).rows[0]!;
    expect(Number(stats.total_score)).toBe(2004);
    expect(Number(stats.play_count)).toBe(2);
    await record(randomUUID(), 1002);
    stats = (
      await db.query<{ total_score: number; play_count: number }>(
        "SELECT * FROM public.player_stats WHERE user_id = auth.uid()",
      )
    ).rows[0]!;
    expect(Number(stats.total_score)).toBe(3006);
    expect(Number(stats.play_count)).toBe(3);
  });
});
it("RLS rejects another user's result; aggregate/history mutation and anonymous insert are forbidden", async () => {
  await asUser(users[0]!, async () => {
    await expect(
      db.query(
        "INSERT INTO public.play_results (id,user_id,song_id,score,accuracy,max_combo,perfect_count,great_count,good_count,miss_count) VALUES ($1,$2,'song',1,100,1,1,0,0,0)",
        [randomUUID(), users[1]],
      ),
    ).rejects.toThrow();
    await expect(db.exec("UPDATE public.player_stats SET total_score = 999999")).rejects.toThrow();
    await expect(db.exec("DELETE FROM public.play_results")).rejects.toThrow();
    await expect(db.exec("UPDATE public.play_results SET score = 999999")).rejects.toThrow();
    await expect(
      db.exec("INSERT INTO public.player_stats VALUES (auth.uid(),9999,1)"),
    ).rejects.toThrow();
    await expect(db.query("SELECT public.accumulate_play_result()")).rejects.toThrow();
    expect(
      (await db.query("SELECT * FROM public.play_results WHERE user_id <> auth.uid()")).rows,
    ).toHaveLength(0);
  });
  await db.exec("SET ROLE anon");
  try {
    await expect(record(randomUUID(), 1)).rejects.toThrow();
    expect((await db.query("SELECT * FROM public.get_global_leaderboard()")).rows.length).toBe(2);
  } finally {
    await db.exec("RESET ROLE");
  }
});
it("ranks all users in the DB including users outside Top 100, with consistent ties", async () => {
  await asUser(users[1]!, () => record(randomUUID(), 4020, "rank-song", 4, 4));
  const top = (
    await db.query<{ user_id: string; total_score: number; global_rank: number }>(
      "SELECT * FROM public.get_global_leaderboard()",
    )
  ).rows;
  expect(top[0]?.user_id).toBe(users[1]);
  expect(Number(top[1]?.global_rank)).toBe(2);
  for (let i = 0; i < 105; i++) {
    const id = randomUUID();
    await db.query("INSERT INTO auth.users VALUES ($1,$2,'{}')", [id, `extra${i}@test.invalid`]);
    await asUser(id, () => record(randomUUID(), 10110, "rank-song", 10, 10));
  }
  const leaders = (
    await db.query<{ global_rank: number }>("SELECT * FROM public.get_global_leaderboard()")
  ).rows;
  expect(leaders).toHaveLength(100);
  expect(leaders.every((row) => Number(row.global_rank) === 1)).toBe(true);
  const mine = (
    await db.query<{ global_rank: number; total_score: number }>(
      "SELECT * FROM public.get_player_ranking($1)",
      [users[0]],
    )
  ).rows[0]!;
  expect(Number(mine.global_rank)).toBe(107);
  expect(Number(mine.total_score)).toBe(3006);
});
it("invalid scores are rejected without changing statistics", async () => {
  await asUser(users[0]!, async () => {
    await expect(record(randomUUID(), -1)).rejects.toThrow();
    await expect(
      db.query("SELECT public.record_play_result($1,'song',1,101,1,1,0,0,0)", [randomUUID()]),
    ).rejects.toThrow();
    await expect(
      db.query("SELECT public.record_play_result($1,'song',999999,100,1,1,0,0,0)", [randomUUID()]),
    ).rejects.toThrow();
    await expect(
      db.query("SELECT public.record_play_result($1,'song',1002,70,1,1,0,0,0)", [randomUUID()]),
    ).rejects.toThrow();
    expect(
      Number(
        (
          await db.query<{ total_score: number }>(
            "SELECT total_score FROM public.player_stats WHERE user_id = auth.uid()",
          )
        ).rows[0]?.total_score,
      ),
    ).toBe(3006);
  });
});

it("returns exact decimal strings for BIGINT leaderboard values", async () => {
  await db.query(
    "UPDATE public.player_stats SET total_score = $1, play_count = $2 WHERE user_id = $3",
    ["9007199254740993", "9007199254740992", users[0]],
  );
  const row = (
    await db.query<{ total_score: string; play_count: string }>(
      "SELECT total_score, play_count FROM public.get_player_ranking($1)",
      [users[0]],
    )
  ).rows[0]!;
  expect(row.total_score).toBe("9007199254740993");
  expect(row.play_count).toBe("9007199254740992");
});

it("validates direct own-user INSERTs, timestamps, nulls, NaN, impossible combos and scores", async () => {
  await asUser(users[1]!, async () => {
    const before = (await db.query("SELECT * FROM public.player_stats WHERE user_id = auth.uid()"))
      .rows;
    await expect(
      db.query(
        "INSERT INTO public.play_results (id,user_id,song_id,score,accuracy,max_combo,perfect_count,great_count,good_count,miss_count) VALUES ($1,auth.uid(),'song',99999,100,1,1,0,0,0)",
        [randomUUID()],
      ),
    ).rejects.toThrow();
    for (const args of [
      [null, "song", 1002, 100, 1, 1, 0, 0, 0],
      [randomUUID(), "song", 1002, "NaN", 1, 1, 0, 0, 0],
      [randomUUID(), "song", 4008, 100, 1, 4, 0, 0, 0],
      [randomUUID(), "song", 4008, 100, 4, 4, 0, 0, 0], // combo bonus must be 20
      [randomUUID(), "song", 1002, 100, 2147483647, 1, 0, 0, 0],
    ])
      await expect(
        db.query("SELECT public.record_play_result($1,$2,$3,$4,$5,$6,$7,$8,$9)", args),
      ).rejects.toThrow();
    await expect(
      db.query(
        "INSERT INTO public.play_results (id,user_id,song_id,score,accuracy,max_combo,perfect_count,great_count,good_count,miss_count,played_at) VALUES ($1,auth.uid(),'song',1002,100,1,1,0,0,0,now())",
        [randomUUID()],
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT * FROM public.player_stats WHERE user_id = auth.uid()")).rows,
    ).toEqual(before);
  });
});

it("acknowledges only the same immutable result and rejects UUID collisions across owners", async () => {
  const id = randomUUID();
  await asUser(users[1]!, async () => {
    await record(id, 1002);
    expect((await record(id, 1002)).rows[0]?.saved).toBe(false);
    await expect(record(id, 1002, "changed-song")).rejects.toThrow(/conflicts/);
  });
  await asUser(users[0]!, async () => {
    await expect(record(id, 1002)).rejects.toThrow(/conflicts/);
  });
});

it("accepts real engine results across misses, mixed judgements and capped long combos", async () => {
  const { applyJudgement, createPlayState } = await import("@/game/engine");
  const { DEFAULT_SCORE_RULES } = await import("@/game/config");
  const id = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1,'validation@test.invalid','{}')", [id]);
  let seed = 73;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed;
  };
  await asUser(id, async () => {
    for (let run = 0; run < 120; run++) {
      const play = createPlayState();
      for (let i = 0; i < run * 3; i++) {
        const judgement =
          run % 10 === 0
            ? "PERFECT"
            : (["PERFECT", "GREAT", "GOOD", "MISS"] as const)[random() % 4]!;
        applyJudgement(play, judgement, 0, DEFAULT_SCORE_RULES, i);
      }
      const c = play.counts;
      const judged = c.PERFECT + c.GREAT + c.GOOD + c.MISS;
      const accuracy = judged ? (100 * (c.PERFECT + c.GREAT * 0.7 + c.GOOD * 0.4)) / judged : 100;
      const saved = await db.query<{ saved: boolean }>(
        "SELECT public.record_play_result($1,'mania-or-selected-fnf',$2,$3,$4,$5,$6,$7,$8) AS saved",
        [randomUUID(), play.score, accuracy, play.maxCombo, c.PERFECT, c.GREAT, c.GOOD, c.MISS],
      );
      expect(saved.rows[0]?.saved).toBe(true);
    }
  });
});

it("includes zero-score users with the same competition rank as each other", async () => {
  const zero = [randomUUID(), randomUUID()];
  for (const id of zero)
    await db.query("INSERT INTO auth.users VALUES ($1,$2,'{}')", [id, `${id}@test.invalid`]);
  const ranks = await Promise.all(
    zero.map((id) =>
      db.query<{ total_score: string; global_rank: string }>(
        "SELECT * FROM public.get_player_ranking($1)",
        [id],
      ),
    ),
  );
  expect(ranks[0]?.rows[0]?.total_score).toBe("0");
  expect(ranks[0]?.rows[0]?.global_rank).toBe(ranks[1]?.rows[0]?.global_rank);
});
