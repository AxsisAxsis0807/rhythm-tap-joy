// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, asUser } from "./helpers/database";
import { createRunConfiguration } from "@/game/runConfiguration";
import type { Chart } from "@/game/types";
let db: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID(),
  revision = randomUUID(),
  group = randomUUID();
const chart: Chart = {
  id: song,
  revisionId: revision,
  audioUrl: "",
  title: "x",
  artist: "x",
  bpm: 60,
  offset: 0,
  laneCount: 4,
  difficultyName: "normal",
  notes: [{ beat: 1, lane: 0, kind: "tap" }],
};
const configuration = createRunConfiguration(chart);
const valid = {
  eligible: true,
  countedMs: 180000,
  headCount: 60,
  successfulHeads: 60,
  chartActiveMs: 180000,
  reason: null,
};
beforeAll(async () => {
  db = await createDatabase();
  for (const id of [owner, other])
    await db.query("INSERT INTO auth.users VALUES($1,$2,'{}')", [id, `${id}@test.invalid`]);
  await db.query(
    "INSERT INTO public.songs(id,user_id,title,is_published) VALUES($1,$2,'song',true)",
    [song, owner],
  );
  await db.query(
    "INSERT INTO public.chart_revisions(id,song_id,chart_key,revision_number,chart_path,audio_path,chart_hash,audio_hash,parser_version,duration_ms,note_count,lane_count,rights_confirmed_by) VALUES($1,$2::uuid,$2::text,1,$3,$4,$5,$5,'pulse-chart-v1',180000,60,4,$6)",
    [
      revision,
      song,
      `${song}/${revision}/chart.json`,
      `${song}/${revision}/audio`,
      "a".repeat(64),
      owner,
    ],
  );
  await db.query("INSERT INTO public.chart_groups(id,group_key) VALUES($1,'test')", [group]);
  await db.query(
    "INSERT INTO public.xp_catalog(revision_id,side,group_id,state,score_rules_version,reviewed_by,reviewed_at,review_reason) VALUES($1,'single',$2,'approved','pulse-score-v1',$3,now(),'test fixture')",
    [revision, group, owner],
  );
}, 30000);
afterAll(() => db.close());
async function begin(nonce = randomUUID()) {
  return (
    await db.query<{ r: { sessionId: string; enabled: boolean } }>(
      "SELECT public.begin_verified_play($1,$2,$3,'single',$4) r",
      [owner, nonce, revision, JSON.stringify(configuration)],
    )
  ).rows[0]!.r;
}
async function accept(id: string, hash = "b".repeat(64)) {
  return db.query("SELECT public.accept_play_evidence($1,$2,$3,$4)", [
    owner,
    id,
    hash,
    JSON.stringify({ runId: id, configuration }),
  ]);
}
async function finish(id: string, result = valid) {
  return (
    await db.query<{
      r: { outcome: { status: string; earnedXp: string; breakdown: { xp: string }[] } };
    }>("SELECT public.finalize_verified_play($1,$2,$3) r", [
      id,
      "b".repeat(64),
      JSON.stringify(result),
    ])
  ).rows[0]!.r;
}
it("all flags start OFF, never derives XP from legacy score", async () => {
  expect((await begin()).enabled).toBe(false);
  expect((await db.query("SELECT * FROM player_progress")).rows).toHaveLength(0);
  await db.exec("UPDATE xp_feature_flags SET enabled=true");
});
it("begin nonce is idempotent; accepted session survives next START", async () => {
  const nonce = randomUUID();
  const a = await begin(nonce);
  expect(a, JSON.stringify(a)).toMatchObject({ enabled: true });
  expect((await begin(nonce)).sessionId).toBe(a.sessionId);
  await accept(a.sessionId);
  await begin();
  expect(
    (
      await db.query<{ status: string }>("SELECT status FROM play_sessions WHERE id=$1", [
        a.sessionId,
      ])
    ).rows[0]?.status,
  ).toBe("accepted");
  const receipt = await finish(a.sessionId);
  expect(receipt.outcome.earnedXp).toBe("190");
  expect(await finish(a.sessionId)).toEqual(receipt);
  await accept(a.sessionId);
  await expect(accept(a.sessionId, "c".repeat(64))).rejects.toThrow(/conflict/);
  expect((await db.query("SELECT * FROM xp_ledger")).rows).toHaveLength(3);
});
it("exact repeat counts, floor, cap, and zero award still consumes first-clear bookkeeping", async () => {
  for (let i = 2; i <= 11; i++) {
    const s = await begin();
    await accept(s.sessionId);
    expect((await finish(s.sessionId)).outcome.earnedXp).toBe(
      String(i <= 5 ? 90 : i <= 10 ? 45 : 22),
    );
  }
  await db.exec("UPDATE xp_daily SET awarded_total=1490");
  const s = await begin();
  await accept(s.sessionId);
  expect((await finish(s.sessionId)).outcome.earnedXp).toBe("10");
  const t = await begin();
  await accept(t.sessionId);
  expect((await finish(t.sessionId)).outcome.earnedXp).toBe("0");
  expect(
    (await db.query<{ completions: number }>("SELECT completions FROM xp_group_daily")).rows[0]
      ?.completions,
  ).toBe(13);
  expect(
    (await db.query<{ awarded_total: number }>("SELECT awarded_total FROM xp_daily")).rows[0]
      ?.awarded_total,
  ).toBe(1500);
});
it("user and anonymous direct mutations/reward RPC rejected; privacy is enforced by RPC", async () => {
  await asUser(db, owner, async () => {
    await expect(db.exec("UPDATE player_progress SET total_xp=99999")).rejects.toThrow();
    await expect(db.exec("SELECT * FROM play_evidence")).rejects.toThrow();
    await expect(begin()).rejects.toThrow(/permission/);
    await db.exec("SELECT save_profile_preferences(0,false,0.5,0.5,1,false)");
    const own = (await db.query<{ r: { growth: unknown } }>("SELECT get_own_xp_progress() r"))
      .rows[0];
    expect(own?.r.growth).not.toBeNull();
  });
  await asUser(db, other, async () =>
    expect(
      (await db.query<{ r: unknown }>("SELECT get_public_xp_progress($1) r", [owner])).rows[0]?.r,
    ).toBeNull(),
  );
});
it("emergency revoke overrides an accepted catalog snapshot without touching Score", async () => {
  const s = await begin();
  await accept(s.sessionId);
  await db.exec("UPDATE xp_catalog SET state='revoked'");
  expect((await finish(s.sessionId)).outcome.status).toBe("ineligible");
  expect((await db.query("SELECT * FROM play_results")).rows).toHaveLength(0);
});
