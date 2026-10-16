// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { Database } from "@/integrations/supabase/types";
import type { SaveSongSettingsInput, SongSettingsRow } from "@/lib/songSettingsContract";
import { settingsMetadata } from "@/lib/songSettingsContract";
const enabled = process.env["PULSE_REAL_STORAGE_TEST"] === "true";
const owner = randomUUID(),
  other = randomUUID(),
  song = randomUUID();
let sql: ReturnType<typeof postgres>,
  client: ReturnType<typeof createClient<Database>>,
  server: Server,
  base: string;
let sourceApi: typeof import("@/lib/songSource.server"),
  settingsApi: typeof import("@/lib/songSettings.server"),
  imageApi: typeof import("@/lib/imageAssets.server"),
  replacementApi: typeof import("@/lib/chartReplacement.server");
let historyBefore: unknown;
let failNextStorageDelete = false;
let row: SongSettingsRow,
  firstReceipt: Awaited<ReturnType<typeof import("@/lib/songSettings.server").saveSettings>>;
let config: {
  databaseUrl: string;
  restUrl: string;
  storageUrl: string;
  secret: string;
  anonKey: string;
  serviceKey: string;
};
const token = (id: string) => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    body = Buffer.from(
      JSON.stringify({
        role: "authenticated",
        sub: id,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
  return `${header}.${body}.${createHmac("sha256", config.secret).update(`${header}.${body}`).digest("base64url")}`;
};
const input = (metadata = settingsMetadata(row)): SaveSongSettingsInput => ({
  songId: song,
  requestId: randomUUID(),
  expectedVersion: row.metadata_version,
  expectedRevisionId: row.current_revision_id,
  metadata,
  background: { action: "keep" },
  gameplay: { action: "keep" },
});
beforeAll(async () => {
  if (!enabled) return;
  config = JSON.parse(await readFile("work/local-storage/connection.json", "utf8"));
  if (new URL(config.databaseUrl).hostname !== "127.0.0.1")
    throw new Error("Only isolated local Storage tests are permitted");
  sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} });
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", base);
      const target = url.pathname.startsWith("/rest/v1/")
        ? config.restUrl + url.pathname.slice(8) + url.search
        : url.pathname.startsWith("/storage/v1/")
          ? config.storageUrl + url.pathname.slice(11) + url.search
          : null;
      if (!target) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (
        failNextStorageDelete &&
        request.method === "DELETE" &&
        url.pathname.startsWith("/storage/v1/")
      ) {
        failNextStorageDelete = false;
        response.writeHead(429, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            statusCode: "429",
            error: "Too Many Requests",
            message: "Injected transient fault",
          }),
        );
        return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value && !["host", "connection", "content-length", "transfer-encoding"].includes(key))
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method ?? "GET",
        headers,
        redirect: "error",
      };
      if (!["GET", "HEAD"].includes(init.method!)) {
        init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
        init.duplex = "half";
      }
      const result = await fetch(target, init);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body)
        Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(response);
      else response.end();
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy binding failed");
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("SUPABASE_URL", base);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", config.serviceKey);
  for (const flag of [
    "PULSE_SONG_SETTINGS_ENABLED",
    "PULSE_SONG_BACKGROUND_ENABLED",
    "PULSE_SONG_TIMING_ENABLED",
    "PULSE_REVISIONS_ENABLED",
  ])
    vi.stubEnv(flag, "true");
  client = createClient<Database>(base, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token(owner)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  sourceApi = await import("@/lib/songSource.server");
  settingsApi = await import("@/lib/songSettings.server");
  imageApi = await import("@/lib/imageAssets.server");
  replacementApi = await import("@/lib/chartReplacement.server");
  for (const id of [owner, other])
    await sql`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${id},${`${id}@test.invalid`},'{}')`;
  const audioPath = `${owner}/${song}/audio`,
    chartPath = `${owner}/${song}/chart`;
  await sql`INSERT INTO songs(id,user_id,title,audio_path,chart_path,chart_type,fnf_side) VALUES(${song},${owner},'legacy fixture',${audioPath},${chartPath},'mania','right')`;
  await sql`UPDATE song_settings_gates SET settings_enabled=true,background_enabled=true,timing_enabled=true`;
  await sql`INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('songs','songs',true,104857600) ON CONFLICT(id) DO NOTHING`;
  const admin = createClient<Database>(base, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const chart = {
    bpm: 120,
    offset: 0,
    notes: [
      { beat: 0.5, lane: 0, kind: "tap" },
      { beat: 1, lane: 1, kind: "hold", lengthBeats: 0.5 },
    ],
  };
  for (const [path, body, mime] of [
    [
      audioPath,
      new Uint8Array(await readFile("tests/fixtures/song-settings/impulse.wav")),
      "audio/wav",
    ],
    [chartPath, new TextEncoder().encode(JSON.stringify(chart)), "application/json"],
  ] as const) {
    const result = await admin.storage
      .from("songs")
      .upload(path, body, { contentType: mime, upsert: false });
    if (result.error)
      throw new Error(
        `Legacy fixture upload failed (${result.error.status}): ${result.error.message}`,
      );
  }
  row = await settingsApi.readSongSettings(client, owner, song);
}, 30000);
afterAll(async () => {
  if (!enabled) return;
  vi.unstubAllEnvs();
  client.auth.stopAutoRefresh();
  await sql.end({ timeout: 2 });
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it.skipIf(!enabled)(
  "actual services: owner authorization and metadata-only save do not create a revision",
  async () => {
    await expect(settingsApi.readSongSettings(client, other, song)).rejects.toThrow(
      "NOT_FOUND_OR_FORBIDDEN",
    );
    firstReceipt = await settingsApi.saveSettings(
      client,
      owner,
      input({ ...settingsMetadata(row), title: "metadata only" }),
    );
    row = firstReceipt.song;
    expect(row.metadata_version).toBe("1");
    expect(row.current_revision_id).toBeNull();
    expect(
      (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`)[0]!["n"],
    ).toBe(0);
  },
);
it.skipIf(!enabled)(
  "actual services: legacy snapshot prepares privately, then timing/preview commit once and replay remains historical",
  async () => {
    const prepared = await sourceApi.prepareSongSource(client, owner, {
      songId: song,
      operationId: randomUUID(),
      expectedVersion: row.metadata_version,
      expectedRevisionId: row.current_revision_id,
    });
    expect(prepared.sourceFormat).toBe("native");
    expect(prepared.timingBasis).toBe("beats");
    expect(prepared.durationMs).toBe(1125);
    expect(
      (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`)[0]!["n"],
    ).toBe(0);
    const payload = {
      ...input({ ...settingsMetadata(row), previewStartMs: 1124 }),
      gameplay: { action: "timing" as const, sourceOperationId: prepared.operationId, offsetMs: 1 },
      rightsConfirmation: { confirmed: true as const, sourceOperationId: prepared.operationId },
    };
    const receipt = await settingsApi.saveSettings(client, owner, payload);
    row = receipt.song;
    expect(row.metadata_version).toBe("2");
    expect(row.is_published).toBe(false);
    expect(row.offset_sec).toBe(0.001);
    expect(await settingsApi.saveSettings(client, owner, payload)).toEqual(receipt);
    const play = randomUUID(),
      group = randomUUID(),
      session = randomUUID();
    await sql`INSERT INTO play_results(id,user_id,song_id,score,accuracy,max_combo,perfect_count,great_count,good_count,miss_count) VALUES(${play},${owner},${song},2006,100,2,2,0,0,0)`;
    await sql`INSERT INTO play_result_context(play_id,revision_id,play_style,policy_id,parser_version,scoring_side) VALUES(${play},${row.current_revision_id},'mania','pulse-mania-v1','pulse-chart-v1','shared')`;
    await sql`INSERT INTO chart_groups(id,group_key) VALUES(${group},${"settings-history-" + group})`;
    await sql`INSERT INTO play_sessions(id,user_id,request_nonce,revision_id,side,group_id,configuration,catalog_snapshot,status) VALUES(${session},${owner},${randomUUID()},${row.current_revision_id},'single',${group},'{}','{}','completed')`;
    await sql`INSERT INTO xp_ledger(user_id,session_id,reward_type,amount,rule_version,reward_date) VALUES(${owner},${session},'play',123,'pulse-xp-v1',current_date)`;
    await sql`INSERT INTO player_progress(user_id,total_xp,version) VALUES(${owner},123,1)`;
    historyBefore =
      await sql`SELECT (SELECT jsonb_agg(to_jsonb(r)) FROM play_results r WHERE user_id=${owner}) scores,(SELECT jsonb_agg(to_jsonb(r)) FROM play_result_context r WHERE play_id=${play}) context,(SELECT jsonb_agg(to_jsonb(r)) FROM player_stats r WHERE user_id=${owner}) stats,(SELECT jsonb_agg(to_jsonb(r)) FROM xp_ledger r WHERE user_id=${owner}) xp,(SELECT jsonb_agg(to_jsonb(r)) FROM player_progress r WHERE user_id=${owner}) progress`;
    const next = await settingsApi.saveSettings(
      client,
      owner,
      input({ ...settingsMetadata(row), artist: "newer" }),
    );
    row = next.song;
    expect((await settingsApi.saveSettings(client, owner, payload)).version).toBe("2");
    expect((await settingsApi.readSongSettings(client, owner, song)).metadata_version).toBe("3");
  },
);
it.skipIf(!enabled)(
  "actual services: real image reserve/upload/pixel verification and atomic metadata/background save",
  async () => {
    const bytes = new Uint8Array(await readFile("tests/fixtures/song-settings/image.png")),
      reservationId = randomUUID();
    const reserve = await imageApi.reserveBackground(owner, {
      songId: song,
      reservationId,
      mime: "image/png",
      expectedBytes: bytes.length,
    });
    const upload = await fetch(reserve.url, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "x-upsert": "false" },
      body: bytes,
    });
    expect(upload.ok).toBe(true);
    const asset = await imageApi.verifyBackground(owner, song, reservationId);
    expect(asset.width).toBe(16);
    expect(asset.height).toBe(9);
    expect(await imageApi.verifyBackground(owner, song, reservationId)).toMatchObject({
      assetId: asset.assetId,
      hash: asset.hash,
    });
    const payload = {
      ...input({ ...settingsMetadata(row), description: "image saved atomically" }),
      background: { action: "replace" as const, assetId: asset.assetId },
    };
    row = (await settingsApi.saveSettings(client, owner, payload)).song;
    expect(row.background_asset_id).toBe(asset.assetId);
    expect(await imageApi.readSongBackground(song)).toBeNull();
    expect(await imageApi.readSongBackground(song, owner)).toMatchObject({
      assetId: asset.assetId,
      hash: asset.hash,
    });
    await expect(imageApi.verifyBackground(other, song, reservationId)).rejects.toThrow(
      "NOT_FOUND_OR_FORBIDDEN",
    );
  },
);
it.skipIf(!enabled)(
  "actual services: private replacement prepares and retries without exposing an uncommitted revision",
  async () => {
    const audio = new Uint8Array(await readFile("tests/fixtures/song-settings/impulse.m4a")),
      chart = new TextEncoder().encode(
        JSON.stringify({ bpm: 100, offset: 0, notes: [{ beat: 0.5, lane: 2, kind: "tap" }] }),
      );
    const identity = {
      songId: song,
      operationId: randomUUID(),
      expectedVersion: row.metadata_version,
      expectedRevisionId: row.current_revision_id,
    };
    const reserve = await replacementApi.reserveReplacement(client, owner, {
      ...identity,
      audioBytes: audio.length,
      chartBytes: chart.length,
      audioMime: "audio/mp4",
      chartType: "mania",
      side: "right",
    });
    if (reserve.prepared) throw new Error("Unexpected prepared replacement");
    for (const [url, body, mime] of [
      [reserve.audioUrl, audio, "audio/mp4"],
      [reserve.chartUrl, chart, "application/json"],
    ] as const)
      expect(
        (
          await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": mime, "x-upsert": "false" },
            body,
          })
        ).ok,
      ).toBe(true);
    const prepared = await replacementApi.prepareReplacement(client, owner, identity);
    expect(prepared.durationMs).toBe(1125);
    expect(
      (
        await replacementApi.reserveReplacement(client, owner, {
          ...identity,
          audioBytes: audio.length,
          chartBytes: chart.length,
          audioMime: "audio/mp4",
          chartType: "mania",
          side: "right",
        })
      ).prepared,
    ).toBe(true);
    const count = (
      await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`
    )[0]!["n"];
    expect(count).toBe(1);
    await expect(
      settingsApi.saveSettings(client, owner, {
        ...input(),
        gameplay: { action: "prepared-replacement", sourceOperationId: prepared.operationId },
        rightsConfirmation: { confirmed: true, sourceOperationId: prepared.operationId },
      }),
    ).rejects.toThrow("INVALID_INPUT");
    const payload = {
      ...input({ ...settingsMetadata(row), previewStartMs: null }),
      gameplay: {
        action: "prepared-replacement" as const,
        sourceOperationId: prepared.operationId,
      },
      rightsConfirmation: { confirmed: true as const, sourceOperationId: prepared.operationId },
      previewConsent: { allowed: false, sourceOperationId: prepared.operationId },
    };
    row = (await settingsApi.saveSettings(client, owner, payload)).song;
    expect(
      (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`)[0]!["n"],
    ).toBe(2);
    expect(row.background_asset_id).not.toBeNull();
    expect(row.is_published).toBe(false);
  },
  30000,
);

it.skipIf(!enabled)(
  "actual services: current canonical AAC is fully decoded and privately prepared again",
  async () => {
    const prepared = await sourceApi.prepareSongSource(client, owner, {
      songId: song,
      operationId: randomUUID(),
      expectedVersion: row.metadata_version,
      expectedRevisionId: row.current_revision_id,
    });
    expect(prepared.durationMs).toBe(1125);
    expect(prepared.sourceFormat).toBe("native");
    expect(prepared.timingBasis).toBe("beats");
    expect(
      (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`)[0]!["n"],
    ).toBe(2);
    await sql`SELECT abandon_song_settings_operation(${owner},${prepared.operationId})`;
  },
  30000,
);

it.skipIf(!enabled)(
  "actual services: nonzero Score/TOTAL SCORE/history/XP/Level inputs and old revision stay unchanged",
  async () => {
    const after =
      await sql`SELECT (SELECT jsonb_agg(to_jsonb(r)) FROM play_results r WHERE user_id=${owner}) scores,(SELECT jsonb_agg(to_jsonb(r)) FROM play_result_context r WHERE play_id IN(SELECT id FROM play_results WHERE user_id=${owner})) context,(SELECT jsonb_agg(to_jsonb(r)) FROM player_stats r WHERE user_id=${owner}) stats,(SELECT jsonb_agg(to_jsonb(r)) FROM xp_ledger r WHERE user_id=${owner}) xp,(SELECT jsonb_agg(to_jsonb(r)) FROM player_progress r WHERE user_id=${owner}) progress`;
    expect(after).toEqual(historyBefore);
    expect(
      (await sql`SELECT count(*)::int n FROM chart_revisions WHERE song_id=${song}`)[0]!["n"],
    ).toBe(2);
  },
);

it.skipIf(!enabled)(
  "actual cleanup service records Storage 429, then retries a leased real deletion; credential check rejects missing and wrong tokens",
  async () => {
    const cleanup = await import("@/lib/assetCleanup.server");
    vi.stubEnv("PULSE_CLEANUP_TOKEN", "local-test-only-cleanup-credential");
    expect(await cleanup.validCleanupCredential(null)).toBe(false);
    expect(await cleanup.validCleanupCredential("Bearer wrong")).toBe(false);
    expect(await cleanup.validCleanupCredential("Bearer local-test-only-cleanup-credential")).toBe(
      true,
    );
    const asset = row.background_asset_id!;
    row = (
      await settingsApi.saveSettings(client, owner, {
        ...input(),
        background: { action: "remove" },
      })
    ).song;
    await sql`UPDATE asset_cleanup_jobs SET not_before=now()-interval '1 day',next_attempt_at=now() WHERE asset_id=${asset}`;
    failNextStorageDelete = true;
    expect((await cleanup.runAssetCleanup()).failed).toBeGreaterThan(0);
    const [job] =
      await sql`SELECT attempts,last_error,completed_at FROM asset_cleanup_jobs WHERE asset_id=${asset}`;
    expect(job!["attempts"]).toBe(1);
    expect(job!["last_error"]).toBe("STORAGE_429");
    expect(job!["completed_at"]).toBeNull();
    await sql`UPDATE asset_cleanup_jobs SET next_attempt_at=now() WHERE asset_id=${asset}`;
    expect((await cleanup.runAssetCleanup()).removed).toBeGreaterThan(0);
    expect(
      (await sql`SELECT completed_at FROM asset_cleanup_jobs WHERE asset_id=${asset}`)[0]![
        "completed_at"
      ],
    ).not.toBeNull();
  },
  30000,
);
