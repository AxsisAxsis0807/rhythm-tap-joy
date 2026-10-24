// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase } from "./helpers/database";
let db: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID(),
  foreignSong = randomUUID(),
  hash = "a".repeat(64);
const metadata = {
  title: "changed",
  artist: "",
  chartAuthor: "",
  difficultyName: "NORMAL",
  description: null,
  recommendedPlayStyle: null,
  previewStartMs: null,
};
async function service<T>(body: () => Promise<T>) {
  await db.exec("SET ROLE service_role");
  try {
    return await body();
  } finally {
    await db.exec("RESET ROLE");
  }
}
const save = (background: unknown) =>
  service(() =>
    db.query("SELECT commit_song_settings($1,$2,$3)", [
      owner,
      {
        songId: song,
        requestId: randomUUID(),
        expectedVersion: "0",
        expectedRevisionId: null,
        metadata,
        background,
        gameplay: { action: "keep" },
      },
      hash,
    ]),
  );
async function asset(
  overrides: {
    owner?: string;
    target?: string;
    purpose?: string;
    expired?: boolean;
    deleting?: boolean;
  } = {},
) {
  const id = randomUUID(),
    actor = overrides.owner ?? owner,
    target = overrides.target ?? song,
    purpose = overrides.purpose ?? "chart-background",
    path = `${actor}/${id}/master`;
  await db.query(
    "INSERT INTO image_reservations(id,owner_id,purpose,target_id,path,mime_type,expected_bytes,state,expires_at) VALUES($1,$2,$3,$4,$5,'image/jpeg',1,'verified',now()+$6::interval)",
    [id, actor, purpose, target, `${actor}/${id}/source`, overrides.expired ? "-1 hour" : "1 hour"],
  );
  await db.query(
    "INSERT INTO image_assets(id,owner_id,purpose,target_id,path,content_hash,mime_type,width,height,byte_size,deleting) VALUES($1,$2,$3,$4,$5,$6,'image/jpeg',1,1,1,$7)",
    [id, actor, purpose, target, path, hash, overrides.deleting ?? false],
  );
  return { id, path };
}
beforeAll(async () => {
  db = await createDatabase();
  for (const id of [owner, other])
    await db.query("INSERT INTO auth.users VALUES($1,$2,'{}')", [id, `${id}@test.invalid`]);
  for (const [id, user] of [
    [song, owner],
    [foreignSong, other],
  ])
    await db.query("INSERT INTO songs(id,user_id,title) VALUES($1,$2,'original')", [id, user]);
  await db.exec(
    "GRANT USAGE ON SCHEMA storage TO service_role; UPDATE song_settings_gates SET settings_enabled=true,background_enabled=true,timing_enabled=true",
  );
}, 30000);
afterAll(() => db.close());
it("D04 rejects foreign owner/target/purpose, expired and deleting images atomically", async () => {
  for (const overrides of [
    { owner: other },
    { target: foreignSong },
    { purpose: "profile-card" },
    { expired: true },
    { deleting: true },
  ]) {
    const image = await asset(overrides);
    await expect(save({ action: "replace", assetId: image.id })).rejects.toThrow("ASSET_NOT_READY");
    expect(
      (
        await db.query(
          "SELECT title,metadata_version::text,background_asset_id FROM songs WHERE id=$1",
          [song],
        )
      ).rows[0],
    ).toEqual({ title: "original", metadata_version: "0", background_asset_id: null });
  }
});
it("D11/S06 leases prevent concurrent claims, forbid a late swap, and finish retries with bounded dead letters", async () => {
  const image = await asset(),
    worker = randomUUID(),
    second = randomUUID();
  await db.query(
    "INSERT INTO asset_cleanup_jobs(bucket_id,path,asset_id,not_before) VALUES('profile-card-images',$1,$2,now()-interval '1 day')",
    [image.path, image.id],
  );
  const claim = () =>
    service(() =>
      db.query<{ id: string; path: string }>("SELECT * FROM claim_song_asset_cleanup($1,8)", [
        worker,
      ]),
    );
  const first = (await claim()).rows;
  expect(first).toHaveLength(1);
  expect(
    (await service(() => db.query("SELECT * FROM claim_song_asset_cleanup($1,8)", [second]))).rows,
  ).toHaveLength(0);
  await expect(save({ action: "replace", assetId: image.id })).rejects.toThrow("ASSET_NOT_READY");
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1) {
      await db.query("UPDATE asset_cleanup_jobs SET next_attempt_at=now() WHERE id=$1", [
        first[0]!.id,
      ]);
      expect((await claim()).rows).toHaveLength(1);
    }
    await service(() =>
      db.query("SELECT finish_song_asset_cleanup($1,$2,'STORAGE_429')", [worker, first[0]!.id]),
    );
  }
  const job = (
    await db.query<{ attempts: number; dead_letter_at: string | null; last_error: string }>(
      "SELECT attempts,dead_letter_at,last_error FROM asset_cleanup_jobs WHERE id=$1",
      [first[0]!.id],
    )
  ).rows[0]!;
  expect(job.attempts).toBe(5);
  expect(job.dead_letter_at).not.toBeNull();
  expect(job.last_error).toBe("STORAGE_429");
  expect((await claim()).rows).toHaveLength(0);
});
it("D12/S07 a live signed token delays raw GC; a terminal exact manifest allows only that orphan deletion", async () => {
  const operation = randomUUID(),
    path = `${song}/${operation}/raw-audio`;
  await db.query(
    "INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version,expires_at,upload_token_expires_at) VALUES($1,$2,$3,'replacement','failed',$4,0,now()-interval '1 hour',now()+interval '1 hour')",
    [operation, owner, song, hash],
  );
  await db.query(
    "INSERT INTO song_edit_objects(bucket_id,path,operation_id) VALUES('chart-revision-assets',$1,$2)",
    [path, operation],
  );
  await db.query(
    "INSERT INTO asset_cleanup_jobs(bucket_id,path,operation_id,not_before) VALUES('chart-revision-assets',$1,$2,now()-interval '1 day')",
    [path, operation],
  );
  expect(
    (await service(() => db.query("SELECT * FROM claim_song_asset_cleanup($1,8)", [randomUUID()])))
      .rows,
  ).toHaveLength(0);
  const expired = randomUUID(),
    orphan = `${song}/${expired}/chart.json`,
    worker = randomUUID();
  await db.query(
    "INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version,expires_at,candidate) VALUES($1,$2,$3,'source','prepared',$4,0,now()-interval '1 hour','{}')",
    [expired, owner, song, hash],
  );
  await db.query(
    "INSERT INTO song_edit_objects(bucket_id,path,operation_id) VALUES('chart-revision-assets',$1,$2)",
    [orphan, expired],
  );
  await db.query(
    "INSERT INTO asset_cleanup_jobs(bucket_id,path,operation_id,not_before) VALUES('chart-revision-assets',$1,$2,now()-interval '1 day')",
    [orphan, expired],
  );
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('chart-revision-assets',$1)", [
    orphan,
  ]);
  expect(
    (
      await service(() =>
        db.query<{ path: string }>("SELECT * FROM claim_song_asset_cleanup($1,8)", [worker]),
      )
    ).rows.some((row) => row.path === orphan),
  ).toBe(true);
  expect(
    (
      await service(() =>
        db.query<{ allowed: boolean }>("SELECT can_reclaim_revision_object($1) allowed", [orphan]),
      )
    ).rows[0]!.allowed,
  ).toBe(true);
  await service(() => db.query("DELETE FROM storage.objects WHERE name=$1", [orphan]));
  await expect(
    service(() =>
      db.query("SELECT commit_song_settings($1,$2,$3)", [
        owner,
        {
          songId: song,
          requestId: randomUUID(),
          expectedVersion: "0",
          expectedRevisionId: null,
          metadata,
          background: { action: "keep" },
          gameplay: { action: "timing", sourceOperationId: expired, offsetMs: 1 },
          rightsConfirmation: { confirmed: true, sourceOperationId: expired },
        },
        hash,
      ]),
    ),
  ).rejects.toThrow("SOURCE_CHANGED");
});
it("D13 readiness checks required schema and bucket state without enabling writes", async () => {
  await db.exec("INSERT INTO storage.buckets(id,name,public) VALUES('songs','songs',true)");
  expect(
    (await service(() => db.query<{ ready: boolean }>("SELECT song_settings_schema_ready() ready")))
      .rows[0]!.ready,
  ).toBe(true);
  await db.exec("ALTER TABLE image_assets DISABLE TRIGGER verified_image_identity");
  expect(
    (await service(() => db.query<{ ready: boolean }>("SELECT song_settings_schema_ready() ready")))
      .rows[0]!.ready,
  ).toBe(false);
  await db.exec("ALTER TABLE image_assets ENABLE TRIGGER verified_image_identity");
});
it("D14 upgrades the prior schema with nonzero legacy history and preserves unchanged long metadata", async () => {
  const prior = await createDatabase("20261016010000");
  const user = randomUUID(),
    legacy = randomUUID();
  try {
    await prior.query("INSERT INTO auth.users VALUES($1,$2,'{}')", [user, `${user}@test.invalid`]);
    await prior.query("INSERT INTO songs(id,user_id,title,preview_start_ms) VALUES($1,$2,$3,123)", [
      legacy,
      user,
      "x".repeat(200),
    ]);
    await prior.query(
      "INSERT INTO play_results(id,user_id,song_id,score,accuracy,max_combo,perfect_count,great_count,good_count,miss_count) VALUES($1,$2,$3,1002,100,1,1,0,0,0)",
      [randomUUID(), user, legacy],
    );
    await prior.query("INSERT INTO player_progress(user_id,total_xp,version) VALUES($1,777,3)", [
      user,
    ]);
    const snapshot = await prior.query(
      "SELECT (SELECT jsonb_agg(to_jsonb(p)) FROM play_results p) results,(SELECT jsonb_agg(to_jsonb(p)) FROM player_stats p) stats,(SELECT jsonb_agg(to_jsonb(p)) FROM player_progress p) progress",
    );
    for (const file of readdirSync("supabase/migrations")
      .sort()
      .filter((file) => file >= "20261016010000"))
      await prior.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    expect(
      await prior.query(
        "SELECT (SELECT jsonb_agg(to_jsonb(p)) FROM play_results p) results,(SELECT jsonb_agg(to_jsonb(p)) FROM player_stats p) stats,(SELECT jsonb_agg(to_jsonb(p)) FROM player_progress p) progress",
      ),
    ).toEqual(snapshot);
    await prior.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
    await prior.exec("SET ROLE authenticated");
    await prior.query(
      "SELECT update_chart_metadata($1,0,NULL,$2,'new artist','','NORMAL',NULL,NULL,123)",
      [legacy, "x".repeat(200)],
    );
    await prior.exec("RESET ROLE");
    expect(
      (
        await prior.query(
          "SELECT title,preview_start_ms,metadata_version::text FROM songs WHERE id=$1",
          [legacy],
        )
      ).rows[0],
    ).toEqual({ title: "x".repeat(200), preview_start_ms: 123, metadata_version: "1" });
  } finally {
    await prior.close();
  }
}, 30000);
