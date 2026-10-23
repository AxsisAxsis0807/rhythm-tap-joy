// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, asUser } from "./helpers/database";
let db: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID(),
  revision = randomUUID();
beforeAll(async () => {
  db = await createDatabase();
  for (const id of [owner, other])
    await db.query("INSERT INTO auth.users VALUES($1,$2,'{}')", [id, `${id}@test.invalid`]);
  await db.query("INSERT INTO songs(id,user_id,title) VALUES($1,$2,'original')", [song, owner]);
}, 30000);
afterAll(() => db.close());
const edit = (version = 0) =>
  db.query(
    "SELECT * FROM update_chart_metadata($1,$2,NULL,'edited','artist','charter','normal','plain text','fnf',NULL)",
    [song, version],
  );
it("owner CAS metadata succeeds without revision, other owner denied and stale update rejected", async () => {
  await asUser(db, other, () => expect(edit()).rejects.toThrow(/owner/));
  await asUser(db, owner, async () => {
    await edit();
    await expect(edit()).rejects.toThrow(/changed/);
    await expect(
      db.query("UPDATE songs SET current_revision_id=$1 WHERE id=$2", [revision, song]),
    ).rejects.toThrow();
    await expect(
      db.query("UPDATE songs SET user_id=$1 WHERE id=$2", [other, song]),
    ).rejects.toThrow();
  });
  expect(
    (
      await db.query<{ title: string; metadata_version: number }>(
        "SELECT title,metadata_version FROM songs",
      )
    ).rows[0]?.title,
  ).toBe("edited");
});
it("immutable snapshots and canonical objects resist mutation; deletion preserves revision identity", async () => {
  await db.query(
    "INSERT INTO chart_revisions(id,song_id,chart_key,revision_number,chart_path,audio_path,chart_hash,audio_hash,parser_version,duration_ms,note_count,lane_count,rights_confirmed_by) VALUES($1,$2::uuid,$2::text,1,$3,$4,$5,$5,'pulse-chart-v1',60000,30,4,$6)",
    [
      revision,
      song,
      `${song}/${revision}/chart.json`,
      `${song}/${revision}/audio`,
      "a".repeat(64),
      owner,
    ],
  );
  await expect(db.exec("UPDATE chart_revisions SET duration_ms=1")).rejects.toThrow(/immutable/);
  await db.query("INSERT INTO storage.objects VALUES('chart-revision-assets',$1)", [
    `${song}/${revision}/audio`,
  ]);
  await expect(
    db.exec("DELETE FROM storage.objects WHERE bucket_id='chart-revision-assets'"),
  ).rejects.toThrow(/immutable/);
  await db.query("DELETE FROM songs WHERE id=$1", [song]);
  expect(
    (
      await db.query<{ song_id: null; chart_key: string }>(
        "SELECT song_id,chart_key FROM chart_revisions",
      )
    ).rows[0],
  ).toEqual({ song_id: null, chart_key: song });
});
it("private bucket and profile settings deny direct image reference and forged uploads", async () => {
  expect(
    (await db.query<{ public: boolean }>("SELECT public FROM storage.buckets")).rows.every(
      (r) => !r.public,
    ),
  ).toBe(true);
  await asUser(db, owner, async () => {
    await expect(
      db.exec("INSERT INTO storage.objects VALUES('asset-staging','fake/source')"),
    ).rejects.toThrow();
    await expect(
      db.exec("UPDATE profile_preferences SET background_asset_id=gen_random_uuid()"),
    ).rejects.toThrow();
    await expect(
      db.exec("SELECT save_profile_preferences(0,true,'NaN',0.5,1,false)"),
    ).rejects.toThrow();
  });
});
it("v2 score context is atomic, idempotent and never retroactively guesses old rows", async () => {
  await asUser(db, owner, async () => {
    const play = randomUUID();
    const record = () =>
      db.query(
        "SELECT record_play_result_v2($1,'legacy',1002,100,1,1,0,0,0,NULL,'fnf','pulse-fnf-v1','pulse-chart-v1','shared') saved",
        [play],
      );
    expect((await record()).rows[0]).toEqual({ saved: true });
    expect((await record()).rows[0]).toEqual({ saved: false });
    await expect(
      db.query(
        "SELECT record_play_result_v2($1,'legacy',1002,100,1,1,0,0,0,NULL,'mania','pulse-mania-v1','pulse-chart-v1','shared')",
        [play],
      ),
    ).rejects.toThrow(/conflicts/);
    expect(
      (
        await db.query<{ total_score: number }>(
          "SELECT total_score FROM player_stats WHERE user_id=auth.uid()",
        )
      ).rows[0]?.total_score,
    ).toBe(1002);
  });
});
