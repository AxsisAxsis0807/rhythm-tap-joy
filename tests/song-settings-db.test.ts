// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase, asUser } from "./helpers/database";
import type { PGlite } from "@electric-sql/pglite";
let db: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID();
const hash = "a".repeat(64);
const metadata = {
  title: "original",
  artist: "",
  chartAuthor: "",
  difficultyName: "NORMAL",
  description: null,
  recommendedPlayStyle: null,
  previewStartMs: null,
};
const payload = (version = "0") => ({
  requestId: randomUUID(),
  songId: song,
  expectedVersion: version,
  expectedRevisionId: null,
  metadata,
  background: { action: "keep" },
  gameplay: { action: "keep" },
});
type Input = ReturnType<typeof payload>;
async function service<T>(run: () => Promise<T>) {
  await db.exec("SET ROLE service_role");
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE");
  }
}
const save = (input: unknown, actor = owner, fingerprint = hash) =>
  service(() =>
    db.query<{ result: { version: string; song: { title: string; is_published: boolean } } }>(
      "SELECT public.commit_song_settings($1,$2,$3) result",
      [actor, input, fingerprint],
    ),
  );
beforeAll(async () => {
  db = await createDatabase();
  for (const id of [owner, other])
    await db.query("INSERT INTO auth.users VALUES($1,$2,'{}')", [id, `${id}@test.invalid`]);
  await db.query("INSERT INTO songs(id,user_id,title) VALUES($1,$2,'original')", [song, owner]);
}, 30000);
afterAll(() => db.close());
it("defaults closed and denies forged actor from authenticated and anon", async () => {
  await expect(save(payload())).rejects.toThrow(/SERVER_NOT_READY/);
  await asUser(db, owner, async () => {
    await expect(
      db.query("SELECT commit_song_settings($1,$2,$3)", [owner, payload(), hash]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.exec("UPDATE song_settings_gates SET settings_enabled=true")).rejects.toThrow();
    await expect(
      db.query("UPDATE songs SET background_asset_id=$1 WHERE id=$2", [randomUUID(), song]),
    ).rejects.toThrow();
    await expect(
      db.query(
        "INSERT INTO songs(id,user_id,title,background_asset_id) VALUES($1,$2,'forged',$3)",
        [randomUUID(), owner, randomUUID()],
      ),
    ).rejects.toThrow();
  });
  await db.exec("SET ROLE anon");
  await expect(db.query("SELECT get_song_settings($1)", [song])).rejects.toThrow();
  await db.exec("RESET ROLE; UPDATE song_settings_gates SET settings_enabled=true");
  await expect(save(payload(), other)).rejects.toThrow(/NOT_FOUND_OR_FORBIDDEN/);
  await asUser(db, other, () =>
    expect(db.query("SELECT get_song_settings($1)", [song])).rejects.toThrow(
      /NOT_FOUND_OR_FORBIDDEN/,
    ),
  );
});
let first: Input;
it("saves once, retains draft publication, rejects stale CAS and replays receipt before CAS", async () => {
  first = { ...payload(), metadata: { ...metadata, title: "saved" } };
  expect((await save(first)).rows[0]?.result).toMatchObject({
    version: "1",
    song: { title: "saved", is_published: false },
  });
  expect((await save(first)).rows[0]?.result.version).toBe("1");
  await expect(save(first, owner, "b".repeat(64))).rejects.toThrow(/REQUEST_CONFLICT/);
  await expect(save(payload())).rejects.toThrow(/STALE_VERSION/);
  await asUser(db, other, async () =>
    expect((await db.query("SELECT * FROM song_edit_operations")).rows).toEqual([]),
  );
});
it("a foreign background rolls back every metadata field and version", async () => {
  await db.exec("UPDATE song_settings_gates SET background_enabled=true");
  await expect(
    save({
      ...payload("1"),
      metadata: { ...metadata, title: "must rollback" },
      background: { action: "replace", assetId: randomUUID() },
    }),
  ).rejects.toThrow(/ASSET_NOT_READY/);
  expect(
    (await db.query("SELECT title,metadata_version::text FROM songs WHERE id=$1", [song])).rows[0],
  ).toEqual({ title: "saved", metadata_version: "1" });
});
it("supports versions beyond JS safe integer through owner projection and CAS", async () => {
  await db.query("UPDATE songs SET metadata_version=9007199254740993 WHERE id=$1", [song]);
  await asUser(db, owner, async () => {
    const result = await db.query<{ value: { metadata_version: string } }>(
      "SELECT get_song_settings($1) value",
      [song],
    );
    expect(result.rows[0]?.value.metadata_version).toBe("9007199254740993");
  });
  expect(
    (await save({ ...payload("9007199254740993"), metadata: { ...metadata, title: "large" } }))
      .rows[0]?.result.version,
  ).toBe("9007199254740994");
  expect((await save(first)).rows[0]?.result.version).toBe("1");
  expect((await db.query("SELECT title FROM songs WHERE id=$1", [song])).rows[0]).toEqual({
    title: "large",
  });
});
it("does not increment the version for a no-op, and retains historical Score and XP", async () => {
  const before = await db.query(
    "SELECT (SELECT count(*) FROM play_results) scores,(SELECT count(*) FROM xp_ledger) xp",
  );
  const unchanged = { ...payload("9007199254740994"), metadata: { ...metadata, title: "large" } };
  expect((await save(unchanged)).rows[0]?.result.version).toBe("9007199254740994");
  expect(
    await db.query(
      "SELECT (SELECT count(*) FROM play_results) scores,(SELECT count(*) FROM xp_ledger) xp",
    ),
  ).toEqual(before);
});
it("commits a prepared timing snapshot atomically, numbers under the song lock and retains the old revision", async () => {
  await db.exec("UPDATE song_settings_gates SET timing_enabled=true");
  const source = randomUUID(),
    request = randomUUID();
  const candidate = {
    request_id: request,
    validated: true,
    chart_path: `${song}/${request}/chart.json`,
    audio_path: `${song}/${request}/audio`,
    chart_hash: hash,
    audio_hash: hash,
    duration_ms: 60000,
    note_count: 10,
    fnf_side: null,
    preview_allowed: false,
    source_format: "native",
    timing_basis: "beats",
    bpm: 120,
    offset: 0.001,
  };
  await db.query(
    "INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version,candidate) VALUES($1,$2,$3,'source','prepared',$4,9007199254740994,$5)",
    [source, owner, song, hash, candidate],
  );
  await db.query("INSERT INTO song_revision_candidates VALUES($1,$2,$3,$4)", [
    request,
    source,
    hash,
    candidate,
  ]);
  const input = {
    ...payload("9007199254740994"),
    requestId: request,
    metadata: { ...metadata, title: "timing", previewStartMs: 59999 },
    gameplay: { action: "timing", sourceOperationId: source, offsetMs: 1 },
    rightsConfirmation: { confirmed: true, sourceOperationId: source },
  };
  const result = await save(input);
  expect(result.rows[0]?.result.version).toBe("9007199254740995");
  expect(
    (
      await db.query(
        "SELECT current_revision_id,is_published,bpm::float8 bpm,offset_sec::float8 offset_sec FROM songs WHERE id=$1",
        [song],
      )
    ).rows[0],
  ).toEqual({ current_revision_id: request, is_published: false, bpm: 120, offset_sec: 0.001 });
  expect(
    (
      await db.query(
        "SELECT revision_number,source_format,timing_basis FROM chart_revisions WHERE id=$1",
        [request],
      )
    ).rows[0],
  ).toEqual({ revision_number: 1, source_format: "native", timing_basis: "beats" });
  await expect(db.exec("DELETE FROM chart_revisions")).rejects.toThrow(/immutable/);
});
it("an expired/abandoned source cannot be committed even with correct candidate bytes", async () => {
  const source = randomUUID(),
    request = randomUUID();
  await db.query(
    "INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version) VALUES($1,$2,$3,'source','abandoned',$4,9007199254740995)",
    [source, owner, song, hash],
  );
  const current = (
    await db.query<{ id: string }>("SELECT current_revision_id id FROM songs WHERE id=$1", [song])
  ).rows[0]!.id;
  await expect(
    save({
      ...payload("9007199254740995"),
      requestId: request,
      expectedRevisionId: current,
      gameplay: { action: "timing", sourceOperationId: source, offsetMs: 1 },
      rightsConfirmation: { confirmed: true, sourceOperationId: source },
    }),
  ).rejects.toThrow(/SOURCE_CHANGED/);
});
