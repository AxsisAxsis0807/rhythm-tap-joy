import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const endpoint = process.env.PULSE_TEST_DATABASE_URL;
if (!endpoint)
  throw new Error("Set PULSE_TEST_DATABASE_URL to an isolated local PostgreSQL server");
const parsed = new URL(endpoint);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
  throw new Error("This verifier only creates databases on localhost");
const name = `pulse_song_settings_test_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(endpoint, { max: 1, onnotice: () => {} });
const target = new URL(endpoint);
target.pathname = `/${name}`;
let sql;
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  sql = postgres(target.href, { max: 12, onnotice: () => {} });
  const helper = await readFile("tests/helpers/database.ts", "utf8");
  let setup = helper.match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
  setup = setup.replace(
    /CREATE ROLE (anon|authenticated|service_role)( BYPASSRLS)?;/g,
    (_, role, extra = "") =>
      `DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}${extra}; END IF; END$$;`,
  );
  await sql.unsafe(setup);
  const migrations = (await readdir("supabase/migrations")).sort();
  for (const file of migrations)
    await sql.unsafe(await readFile(`supabase/migrations/${file}`, "utf8"));
  const [version] = await sql`SELECT version()`;
  console.log({ postgres: version.version, migrations: migrations.length });
  const owner = randomUUID(),
    other = randomUUID();
  for (const id of [owner, other])
    await sql`INSERT INTO auth.users VALUES(${id},${`${id}@test.invalid`},'{}')`;
  await sql`UPDATE public.song_settings_gates SET settings_enabled=true,background_enabled=true,timing_enabled=true`;
  const metadata = {
    title: "edited",
    artist: "",
    chartAuthor: "",
    difficultyName: "NORMAL",
    description: null,
    recommendedPlayStyle: null,
    previewStartMs: null,
  };
  const createSong = async () => {
    const id = randomUUID();
    await sql`INSERT INTO songs(id,user_id,title) VALUES(${id},${owner},'original')`;
    return id;
  };
  const payload = (song, request = randomUUID()) => ({
    songId: song,
    requestId: request,
    expectedVersion: "0",
    expectedRevisionId: null,
    metadata,
    background: { action: "keep" },
    gameplay: { action: "keep" },
  });
  const service = (body) =>
    sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      return body(tx);
    });
  const save = (input, actor = owner) =>
    service(
      (tx) =>
        tx`SELECT public.commit_song_settings(${actor},${tx.json(input)},${"a".repeat(64)}) result`,
    );
  const song = await createSong();
  const concurrent = await Promise.allSettled([save(payload(song)), save(payload(song))]);
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(concurrent.find((x) => x.status === "rejected").reason.code, "40001");
  assert.equal((await sql`SELECT metadata_version::text v FROM songs WHERE id=${song}`)[0].v, "1");
  console.log("PASS native multi-connection CAS");
  const retrySong = await createSong(),
    same = payload(retrySong);
  const receipts = await Promise.all(Array.from({ length: 5 }, () => save(same)));
  for (const result of receipts) assert.equal(result[0].result.version, "1");
  assert.equal(
    (await sql`SELECT count(*)::int n FROM song_edit_operations WHERE song_id=${retrySong}`)[0].n,
    1,
  );
  console.log("PASS five concurrent identical save intents / one receipt");
  await assert.rejects(save(payload(await createSong()), other), (error) => error.code === "42501");
  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub',${owner},true)`;
      await tx`SELECT commit_song_settings(${owner},${tx.json(payload(song))},${"a".repeat(64)})`;
    }),
    (error) => error.code === "42501",
  );
  console.log(
    "PASS owner and service-only boundaries using real SQL roles (not real Supabase JWTs)",
  );
  const timingSong = await createSong();
  const timing = async () => {
    const request = randomUUID(),
      source = randomUUID(),
      hash = "a".repeat(64);
    const candidate = {
      request_id: request,
      validated: true,
      chart_path: `${timingSong}/${request}/chart.json`,
      audio_path: `${timingSong}/${request}/audio`,
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
    await sql`INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version,candidate) VALUES(${source},${owner},${timingSong},'source','prepared',${hash},0,${sql.json(candidate)})`;
    await sql`INSERT INTO song_revision_candidates VALUES(${request},${source},${hash},${sql.json(candidate)})`;
    return {
      ...payload(timingSong, request),
      gameplay: { action: "timing", sourceOperationId: source, offsetMs: 1 },
      rightsConfirmation: { confirmed: true, sourceOperationId: source },
    };
  };
  const intents = await Promise.all([timing(), timing()]);
  const revisions = await Promise.allSettled(intents.map((input) => save(input)));
  assert.equal(revisions.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${timingSong}`)[0].n,
    1,
  );
  assert.equal(
    (await sql`SELECT revision_number FROM chart_revisions WHERE song_id=${timingSong}`)[0]
      .revision_number,
    1,
  );
  assert.equal(
    (await sql`SELECT is_published FROM songs WHERE id=${timingSong}`)[0].is_published,
    false,
  );
  console.log("PASS concurrent timing revisions / atomic numbering / draft publication preserved");
  for (let iteration = 0; iteration < 4; iteration++) {
    const imageSong = await createSong(),
      asset = randomUUID(),
      path = `${owner}/${asset}/master`;
    await sql`INSERT INTO image_reservations(id,owner_id,purpose,target_id,path,mime_type,expected_bytes,state) VALUES(${asset},${owner},'chart-background',${imageSong},${`${owner}/${asset}/source`},'image/jpeg',1,'verified')`;
    await sql`INSERT INTO image_assets(id,owner_id,purpose,target_id,path,content_hash,mime_type,width,height,byte_size) VALUES(${asset},${owner},'chart-background',${imageSong},${path},${"a".repeat(64)},'image/jpeg',1,1,1)`;
    await sql`INSERT INTO asset_cleanup_jobs(bucket_id,path,asset_id,not_before) VALUES('profile-card-images',${path},${asset},now()-interval '1 day')`;
    const update = { ...payload(imageSong), background: { action: "replace", assetId: asset } };
    const clean = () =>
      service((tx) => tx`SELECT * FROM claim_song_asset_cleanup(${randomUUID()},8)`);
    await Promise.allSettled(iteration % 2 ? [save(update), clean()] : [clean(), save(update)]);
    const state = (
      await sql`SELECT s.background_asset_id,a.deleting FROM songs s JOIN image_assets a ON a.id=${asset} WHERE s.id=${imageSong}`
    )[0];
    assert.ok(state.background_asset_id === null || state.deleting === false);
  }
  console.log("PASS four native cleanup/save races / no pointer to a deleting image");
  const scores =
    await sql`SELECT (SELECT count(*) FROM play_results)::text scores,(SELECT count(*) FROM xp_ledger)::text xp`;
  assert.equal(scores[0].scores, "0");
  assert.equal(scores[0].xp, "0");
  console.log("PASS no result/XP writes from settings operations");
  console.log(
    "Native PostgreSQL verification complete; Storage API, actual JWTs and deployed runtime are separate checks.",
  );
} finally {
  if (sql) await sql.end({ timeout: 2 });
  await admin.end({ timeout: 2 });
  // Keep the uniquely named local database for inspection. No shared database is reset or dropped.
}
