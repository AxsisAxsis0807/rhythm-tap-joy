// Run only against the disposable local Storage/PostgREST stack described in docs.
import { readFile, readdir } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import postgres from "postgres";
const config = JSON.parse(
  await readFile(
    process.env.PULSE_STORAGE_TEST_CONFIG ?? "work/local-storage/connection.json",
    "utf8",
  ),
);
if (!["127.0.0.1", "localhost", "db"].includes(new URL(config.databaseUrl).hostname))
  throw new Error("Only an isolated local database is allowed");
for (const [key, allowed] of [
  ["storageUrl", ["localhost", "127.0.0.1"]],
  ["restUrl", ["localhost", "127.0.0.1", "rest"]],
])
  if (!allowed.includes(new URL(config[key]).hostname))
    throw new Error("Only isolated local APIs are allowed");
const sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} });
const jwt = (role, sub) => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({
        role,
        ...(sub ? { sub } : {}),
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", config.secret).update(`${header}.${payload}`).digest("base64url")}`;
};
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID(),
  tokens = {
    owner: jwt("authenticated", owner),
    other: jwt("authenticated", other),
    anon: config.anonKey,
    service: config.serviceKey,
  };
async function request(base, path, token, method = "GET", body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: response.status, value };
}
const rest = (path, token = tokens.owner, method = "GET", body) =>
  request(config.restUrl, path, token, method, body);
const storage = (path, token = tokens.owner, method = "GET", body, headers) =>
  request(config.storageUrl, path, token, method, body, headers);
const failure = (response, label) =>
  assert.ok(response.status >= 400, `${label}: expected rejection, status ${response.status}`);
try {
  const migrations = (await readdir("supabase/migrations")).sort();
  for (const file of process.env.PULSE_STORAGE_APPLY_MIGRATIONS === "false" ? [] : migrations)
    await sql.unsafe(await readFile(`supabase/migrations/${file}`, "utf8"));
  await sql`NOTIFY pgrst,'reload schema'`;
  for (const id of [owner, other])
    await sql`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${id},${`${id}@test.invalid`},'{}')`;
  await sql`INSERT INTO songs(id,user_id,title) VALUES(${song},${owner},'private fixture')`;
  await sql`UPDATE song_settings_gates SET settings_enabled=true,background_enabled=true,timing_enabled=true`;
  for (let i = 0; i < 30; i++) {
    const read = await rest("/rpc/get_song_settings", tokens.owner, "POST", { p_song_id: song });
    if (read.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await rest("/rpc/get_song_settings", tokens.owner, "POST", { p_song_id: song })).status,
    200,
  );
  for (const token of [tokens.other, tokens.anon])
    failure(
      await rest("/rpc/get_song_settings", token, "POST", { p_song_id: song }),
      "foreign/anonymous private read",
    );
  failure(
    await rest("/rpc/commit_song_settings", tokens.owner, "POST", {
      p_actor: owner,
      p_payload: {},
      p_payload_hash: "a".repeat(64),
    }),
    "authenticated service RPC",
  );
  failure(
    await rest(`/songs?id=eq.${song}`, tokens.owner, "PATCH", {
      background_asset_id: randomUUID(),
    }),
    "protected pointer update",
  );
  console.log(
    "PASS real PostgREST JWT verification / private ownership / service-only grants / protected pointer",
  );
  const bytes = new Uint8Array(await readFile("tests/fixtures/song-settings/image.jpg")),
    reservation = randomUUID(),
    path = `${owner}/${reservation}/source`;
  await sql`SELECT reserve_song_background(${owner},${song},${reservation},'image/jpeg',${bytes.length})`;
  const signed = await storage(
    `/object/upload/sign/asset-staging/${path}`,
    tokens.service,
    "POST",
    { upsert: false },
  );
  assert.equal(signed.status, 200, `signed stage status ${signed.status}`);
  const upload = await storage(signed.value.url, tokens.anon, "PUT", bytes, {
    "Content-Type": "image/jpeg",
    "x-upsert": "false",
  });
  assert.equal(upload.status, 200, `signed upload status ${upload.status}`);
  failure(
    await storage(signed.value.url, tokens.anon, "PUT", bytes, {
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    }),
    "signed insert-only replay/upsert",
  );
  failure(
    await storage(
      `/object/asset-staging/${other}/${randomUUID()}/source`,
      tokens.owner,
      "POST",
      bytes,
      { "Content-Type": "image/jpeg" },
    ),
    "foreign staging path",
  );
  failure(
    await storage(
      `/object/asset-staging/${owner}/${randomUUID()}/source`,
      tokens.owner,
      "POST",
      bytes,
      { "Content-Type": "image/jpeg" },
    ),
    "unreserved staging path",
  );
  failure(
    await storage(`/object/sign/asset-staging/${path}`, tokens.other, "POST", { expiresIn: 60 }),
    "foreign staging read",
  );
  console.log(
    "PASS real Storage signed upload / insert-only replay / arbitrary path and foreign access rejection",
  );
  const limited = randomUUID(),
    limitedPath = `${owner}/${limited}/source`;
  await sql`SELECT reserve_song_background(${owner},${song},${limited},'image/jpeg',1)`;
  const limitedSigned = await storage(
    `/object/upload/sign/asset-staging/${limitedPath}`,
    tokens.service,
    "POST",
    { upsert: false },
  );
  assert.equal(limitedSigned.status, 200);
  failure(
    await storage(limitedSigned.value.url, tokens.anon, "PUT", bytes, {
      "Content-Type": "image/jpeg",
      "x-upsert": "false",
    }),
    "declared image byte size",
  );
  const late = randomUUID(),
    latePath = `${owner}/${late}/source`;
  await sql`SELECT reserve_song_background(${owner},${song},${late},'image/jpeg',${bytes.length})`;
  const lateSigned = await storage(
    `/object/upload/sign/asset-staging/${latePath}`,
    tokens.service,
    "POST",
    { upsert: false },
  );
  assert.equal(lateSigned.status, 200);
  await sql`UPDATE image_reservations SET expires_at=now()-interval '1 minute' WHERE id=${late}`;
  await sql`UPDATE asset_cleanup_jobs SET not_before=now()-interval '1 day' WHERE path=${latePath}`;
  const lateClaims = await sql`SELECT * FROM claim_song_asset_cleanup(${randomUUID()},8)`;
  assert.ok(
    !lateClaims.some((job) => job.path === latePath),
    "unexpired signed token prevents early cleanup",
  );
  assert.equal(
    (
      await storage(lateSigned.value.url, tokens.anon, "PUT", bytes, {
        "Content-Type": "image/jpeg",
        "x-upsert": "false",
      })
    ).status,
    200,
  );
  await assert.rejects(
    sql`SELECT reserve_song_background(${owner},${song},${late},'image/jpeg',${bytes.length})`,
    (error) => error.code === "22023",
  );
  console.log(
    "PASS actual Storage declared-size enforcement / late signed token remains valid / expired reservation rejects verification-reserve / cleanup waits for token expiry",
  );
  const imagePath = `${owner}/${reservation}/master`;
  assert.equal(
    (
      await storage(`/object/profile-card-images/${imagePath}`, tokens.service, "POST", bytes, {
        "Content-Type": "image/jpeg",
      })
    ).status,
    200,
  );
  await sql`INSERT INTO image_assets(id,owner_id,purpose,target_id,path,content_hash,mime_type,width,height,byte_size) VALUES(${reservation},${owner},'chart-background',${song},${imagePath},${"b".repeat(64)},'image/jpeg',16,9,${bytes.length})`;
  await sql`UPDATE image_reservations SET state='verified' WHERE id=${reservation}`;
  await assert.rejects(
    sql`UPDATE image_assets SET content_hash=${"c".repeat(64)} WHERE id=${reservation}`,
    (error) => error.code === "42501",
  );
  failure(
    await storage(`/object/profile-card-images/${imagePath}`, tokens.service, "PUT", bytes, {
      "Content-Type": "image/jpeg",
    }),
    "canonical image overwrite",
  );
  await storage("/object/profile-card-images", tokens.service, "DELETE", { prefixes: [imagePath] });
  assert.equal(
    (await sql`SELECT count(*)::int n FROM storage.objects WHERE name=${imagePath}`)[0].n,
    1,
  );
  await sql`INSERT INTO asset_cleanup_jobs(bucket_id,path,asset_id,not_before) VALUES('profile-card-images',${imagePath},${reservation},now()-interval '1 day')`;
  const m = {
    title: "private fixture",
    artist: "",
    chartAuthor: "",
    difficultyName: "NORMAL",
    description: null,
    recommendedPlayStyle: null,
    previewStartMs: null,
  };
  const imageSave = {
    songId: song,
    requestId: randomUUID(),
    expectedVersion: "0",
    expectedRevisionId: null,
    metadata: m,
    background: { action: "replace", assetId: reservation },
    gameplay: { action: "keep" },
  };
  await sql`SELECT commit_song_settings(${owner},${sql.json(imageSave)},${"d".repeat(64)})`;
  assert.ok(
    !(await sql`SELECT * FROM claim_song_asset_cleanup(${randomUUID()},8)`).some(
      (job) => job.path === imagePath,
    ),
  );
  const remove = {
    ...imageSave,
    requestId: randomUUID(),
    expectedVersion: "1",
    background: { action: "remove" },
  };
  await sql`SELECT commit_song_settings(${owner},${sql.json(remove)},${"e".repeat(64)})`;
  await sql`UPDATE asset_cleanup_jobs SET not_before=now()-interval '1 day',next_attempt_at=now() WHERE path=${imagePath}`;
  const imageWorker = randomUUID(),
    imageClaims = await sql`SELECT * FROM claim_song_asset_cleanup(${imageWorker},8)`;
  const imageJob = imageClaims.find((job) => job.path === imagePath);
  assert.ok(imageJob);
  assert.equal(
    (
      await storage("/object/profile-card-images", tokens.service, "DELETE", {
        prefixes: [imagePath],
      })
    ).status,
    200,
  );
  await sql`SELECT finish_song_asset_cleanup(${imageWorker},${imageJob.id},NULL)`;
  assert.equal(
    (await sql`SELECT count(*)::int n FROM storage.objects WHERE name=${imagePath}`)[0].n,
    0,
  );
  assert.ok((await sql`SELECT deleted_at FROM image_assets WHERE id=${reservation}`)[0].deleted_at);
  console.log(
    "PASS immutable verified image bytes and identity / referenced image retained / atomic pointer remove / leased real Storage deletion and completion",
  );
  const source = randomUUID(),
    canonical = `${song}/${source}/chart.json`,
    hash = "a".repeat(64);
  await sql`INSERT INTO song_edit_operations(id,owner_id,song_id,kind,state,payload_hash,expected_version) VALUES(${source},${owner},${song},'source','failed',${hash},0)`;
  await sql`INSERT INTO song_edit_objects(bucket_id,path,operation_id) VALUES('chart-revision-assets',${canonical},${source})`;
  await sql`INSERT INTO asset_cleanup_jobs(bucket_id,path,operation_id,not_before) VALUES('chart-revision-assets',${canonical},${source},now()-interval '1 day')`;
  assert.equal(
    (
      await storage(
        `/object/chart-revision-assets/${canonical}`,
        tokens.service,
        "POST",
        new TextEncoder().encode("{}"),
        { "Content-Type": "application/json" },
      )
    ).status,
    200,
  );
  failure(
    await storage(
      `/object/chart-revision-assets/${canonical}`,
      tokens.service,
      "PUT",
      new TextEncoder().encode("{}"),
      { "Content-Type": "application/json" },
    ),
    "canonical overwrite",
  );
  const deniedDelete = await storage("/object/chart-revision-assets", tokens.service, "DELETE", {
    prefixes: [canonical],
  });
  // Storage may return 200 with an empty list on an object protected by its DB trigger.
  assert.equal(
    (
      await sql`SELECT count(*)::int n FROM storage.objects WHERE bucket_id='chart-revision-assets' AND name=${canonical}`
    )[0].n,
    1,
    `unmarked immutable delete ${deniedDelete.status}`,
  );
  await sql`UPDATE song_edit_operations SET expires_at=now()-interval '1 hour' WHERE id=${source}`;
  const worker = randomUUID();
  const claims = await sql`SELECT * FROM claim_song_asset_cleanup(${worker},8)`;
  assert.ok(claims.some((job) => job.path === canonical));
  const reclaimed = await storage("/object/chart-revision-assets", tokens.service, "DELETE", {
    prefixes: [canonical],
  });
  assert.equal(reclaimed.status, 200);
  assert.equal(
    (await sql`SELECT count(*)::int n FROM storage.objects WHERE name=${canonical}`)[0].n,
    0,
  );
  console.log(
    "PASS actual Storage DB role / immutable UPDATE+unmarked DELETE rejected / exact leased orphan DELETE permitted",
  );
  console.log(
    `Storage verification complete: ${migrations.length} migrations, Storage API 1.82.1, PostgREST 16.4, actual locally signed JWTs. No production resources used.`,
  );
} finally {
  await sql.end({ timeout: 2 });
}
