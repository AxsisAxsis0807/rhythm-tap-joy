import { z } from "zod";
import { sha256 as incrementalHash } from "@noble/hashes/sha2.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseChartByType } from "@/game/chartFile";
import { canonicalJson, sha256 } from "./xpContract";
import {
  MAX_CHART_BYTES,
  validateCanonicalChart,
  assertManagedPath,
  validateRevisionSource,
} from "./chartValidation";
import {
  readSongSettings,
  songSettingsCapabilities,
  SongSettingsError,
} from "./songSettings.server";
import { settingsDatabase, settingsJson as toJson } from "./songSettingsDatabase";
import {
  applySongTiming,
  metadataVersionSchema,
  preparedSongSourceSchema,
  type PrepareSongSourceInput,
  type SaveSongSettingsInput,
} from "./songSettingsContract";
import { openStorageObject, readBoundedStorage, sniffAudioStream } from "./boundedStorage.server";
import { analyzeAudioStream } from "./audioAnalysis";
import { MAX_AUDIO_BYTES } from "./waveform";
import { backpressuredTee } from "./streamTee";
import { signedAudioRanges } from "./audioRange";
const db = () => settingsDatabase(supabaseAdmin);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema = z.object({
  audio_path: z.string(),
  chart_path: z.string(),
  audio_hash: hash,
  chart_hash: hash,
  duration_ms: z.number().int().positive().max(7200000),
  bpm: z.number().positive().finite(),
  offset: z.number().finite(),
  note_count: z.number().int().positive(),
  fnf_side: z.enum(["left", "right"]).nullable(),
  mime: z.string(),
  preview_allowed: z.boolean(),
  source_format: z.enum(["native", "osu", "fnf-legacy", "fnf-vslice", "unknown"]),
  timing_basis: z.enum(["beats", "absolute-seconds", "unknown"]),
  replacement: z
    .object({
      bucket: z.string(),
      audioPath: z.string(),
      chartPath: z.string(),
      chartType: z.enum(["mania", "fnf"]),
      side: z.enum(["left", "right"]),
      audioBytes: z.number().int(),
      chartBytes: z.number().int(),
      audioMime: z.string().optional(),
    })
    .optional(),
  legacy: z
    .object({ audio_path: z.string(), chart_path: z.string(), chart_source_hash: hash })
    .optional(),
});
const operationSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  song_id: z.string().uuid(),
  kind: z.enum(["source", "replacement", "save"]),
  state: z.string(),
  expected_version: metadataVersionSchema,
  expected_revision_id: z.string().uuid().nullable(),
  expires_at: z.string(),
  worker_id: z.string().uuid().nullable(),
  candidate: z.unknown(),
});
async function manifest(path: string, operationId: string) {
  const result = await db()
    .from("song_edit_objects")
    .upsert(
      { bucket_id: "chart-revision-assets", path, operation_id: operationId },
      { onConflict: "bucket_id,path", ignoreDuplicates: true },
    );
  if (result.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  const job = await db()
    .from("asset_cleanup_jobs")
    .upsert(
      { bucket_id: "chart-revision-assets", path, operation_id: operationId },
      { onConflict: "bucket_id,path", ignoreDuplicates: true },
    );
  if (job.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
}
async function writeChart(
  path: string,
  bytes: Uint8Array,
  expectedHash: string,
  operationId: string,
) {
  await manifest(path, operationId);
  await supabaseAdmin.storage
    .from("chart-revision-assets")
    .upload(path, bytes, { contentType: "application/json", upsert: false });
  if (
    (await sha256(await readBoundedStorage("chart-revision-assets", path, MAX_CHART_BYTES))) !==
    expectedHash
  )
    throw new SongSettingsError("ASSET_NOT_READY");
}
async function hashAudio(bucket: string, path: string) {
  const response = await openStorageObject(bucket, path, AbortSignal.timeout(240000));
  const reader = response.body!.getReader(),
    hasher = incrementalHash.create();
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > MAX_AUDIO_BYTES) throw new SongSettingsError("INVALID_INPUT");
      hasher.update(item.value);
    }
    return [...hasher.digest()].map((x) => x.toString(16).padStart(2, "0")).join("");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function projection(operationId: string, c: z.infer<typeof candidateSchema>) {
  const sign = async (path: string) => {
    const result = await supabaseAdmin.storage
      .from("chart-revision-assets")
      .createSignedUrl(assertManagedPath(path), 600);
    if (result.error || !result.data) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
    return result.data.signedUrl;
  };
  return preparedSongSourceSchema.parse({
    operationId,
    audioHash: c.audio_hash,
    durationMs: c.duration_ms,
    audioUrl: await sign(c.audio_path),
    chartUrl: await sign(c.chart_path),
    expiresAt: Date.now() + 600000,
    bpm: c.bpm,
    offset: c.offset,
    sourceFormat: c.source_format,
    timingBasis: c.timing_basis,
    previewAllowed: c.preview_allowed,
  });
}
export async function prepareSongSource(
  client: SupabaseClient<Database>,
  actor: string,
  input: PrepareSongSourceInput,
  replacement?: {
    bucket: string;
    audioPath: string;
    chartPath: string;
    chartType: "mania" | "fnf";
    side: "left" | "right";
    audioBytes: number;
    chartBytes: number;
    audioMime?: string | undefined;
  },
) {
  const { installAudioModules } = await import("./codecs/staticAudioModules.server");
  installAudioModules();
  if (!(await songSettingsCapabilities()).songTimingRevisionEnabled)
    throw new SongSettingsError("SERVER_NOT_READY");
  const row = await readSongSettings(client, actor, input.songId);
  const worker = crypto.randomUUID();
  const fingerprint = await sha256(new TextEncoder().encode(canonicalJson(input)));
  const begin = await db().rpc("begin_song_settings_source", {
    p_actor: actor,
    p_id: input.operationId,
    p_song_id: input.songId,
    p_version: input.expectedVersion,
    p_revision: input.expectedRevisionId,
    p_hash: fingerprint,
    p_worker: worker,
    p_kind: replacement ? "replacement" : "source",
  });
  if (begin.error)
    throw new SongSettingsError(
      begin.error.code === "40001"
        ? "STALE_VERSION"
        : begin.error.code === "42501"
          ? "NOT_FOUND_OR_FORBIDDEN"
          : "SERVER_NOT_READY",
    );
  const op = operationSchema.parse(begin.data);
  if (op.state === "prepared") return projection(op.id, candidateSchema.parse(op.candidate));
  try {
    let candidate: z.infer<typeof candidateSchema>;
    if (row.current_revision_id && !replacement) {
      const revision = await db()
        .from("chart_revisions")
        .select("*")
        .eq("id", row.current_revision_id)
        .eq("song_id", row.id)
        .single();
      if (revision.error || !revision.data) throw new SongSettingsError("ASSET_NOT_READY");
      const r = revision.data,
        bytes = await readBoundedStorage("chart-revision-assets", r.chart_path, MAX_CHART_BYTES);
      if ((await sha256(bytes)) !== r.chart_hash) throw new SongSettingsError("SOURCE_CHANGED");
      const signal = AbortSignal.timeout(240000);
      const audio = await openStorageObject("chart-revision-assets", r.audio_path, signal);
      const analysis = await analyzeAudioStream(audio.body!, signal, undefined, async (size) =>
        signedAudioRanges(audio.url, size, signal),
      );
      if (
        analysis.audioHash !== r.audio_hash ||
        Math.abs(analysis.waveform.durationMs - r.duration_ms) > 1
      )
        throw new SongSettingsError("SOURCE_CHANGED");
      const chart = validateCanonicalChart(
        JSON.parse(new TextDecoder().decode(bytes)),
        analysis.waveform.durationMs,
      );
      candidate = {
        audio_path: r.audio_path,
        chart_path: r.chart_path,
        audio_hash: r.audio_hash,
        chart_hash: r.chart_hash,
        duration_ms: analysis.waveform.durationMs,
        bpm: chart.bpm,
        offset: chart.offset,
        note_count: chart.notes.length,
        fnf_side: chart.fnf?.playerSide ?? null,
        mime: analysis.mime,
        preview_allowed: r.preview_allowed,
        source_format: z
          .enum(["native", "osu", "fnf-legacy", "fnf-vslice", "unknown"])
          .parse(r.source_format),
        timing_basis: z.enum(["beats", "absolute-seconds", "unknown"]).parse(r.timing_basis),
      };
    } else {
      const legacy = replacement
        ? null
        : await supabaseAdmin
            .from("songs")
            .select("audio_path,chart_path,chart_type,fnf_side")
            .eq("id", row.id)
            .eq("user_id", actor)
            .single();
      if (!replacement && (legacy?.error || !legacy?.data?.audio_path || !legacy.data.chart_path))
        throw new SongSettingsError("ASSET_NOT_READY");
      const bucket = replacement?.bucket ?? "songs";
      const audioPath = replacement
        ? assertManagedPath(replacement.audioPath)
        : assertManagedPath(legacy!.data!.audio_path!, actor);
      const chartPath = replacement
        ? assertManagedPath(replacement.chartPath)
        : assertManagedPath(legacy!.data!.chart_path!, actor);
      const sourceBytes = await readBoundedStorage(bucket, chartPath, MAX_CHART_BYTES);
      if (replacement && sourceBytes.length !== replacement.chartBytes)
        throw new SongSettingsError("INVALID_INPUT");
      const sourceText = new TextDecoder().decode(sourceBytes);
      if (replacement) validateRevisionSource(sourceText);
      // Legacy PLAY uses the existing parser unchanged. Canonical snapshots never re-enter it.
      const parsed = parseChartByType(
        sourceText,
        replacement?.chartType ?? (legacy!.data!.chart_type === "fnf" ? "fnf" : "mania"),
        replacement?.side ?? (legacy!.data!.fnf_side === "left" ? "left" : "right"),
      );
      const finalAudio = `${row.id}/${op.id}/audio`,
        finalChart = `${row.id}/${op.id}/chart.json`;
      await manifest(finalAudio, op.id);
      const response = await openStorageObject(bucket, audioPath, AbortSignal.timeout(240000));
      const sniffed = await sniffAudioStream(response.body!);
      const [analysisStream, uploadStream] = backpressuredTee(sniffed.stream);
      const uploadPromise = supabaseAdmin.storage
        .from("chart-revision-assets")
        .upload(finalAudio, uploadStream, { contentType: sniffed.mime, upsert: false });
      const analysisPromise = analyzeAudioStream(
        analysisStream,
        AbortSignal.timeout(240000),
        undefined,
        async (size) => {
          await uploadPromise;
          const signed = await supabaseAdmin.storage
            .from("chart-revision-assets")
            .createSignedUrl(finalAudio, 600);
          if (signed.error || !signed.data) throw new SongSettingsError("ASSET_NOT_READY");
          return signedAudioRanges(signed.data.signedUrl, size, AbortSignal.timeout(240000));
        },
      );
      const [analysis] = await Promise.all([analysisPromise, uploadPromise]);
      if (replacement && analysis.bytes !== replacement.audioBytes)
        throw new SongSettingsError("INVALID_INPUT");
      if ((await hashAudio("chart-revision-assets", finalAudio)) !== analysis.audioHash)
        throw new SongSettingsError("ASSET_NOT_READY");
      const chart = validateCanonicalChart(
        {
          id: row.id,
          title: row.title,
          artist: row.artist,
          difficultyName: row.difficulty_name,
          audioUrl: "",
          bpm: parsed.bpm,
          offset: parsed.offset,
          laneCount: parsed.laneCount,
          notes: parsed.notes,
          ...(parsed.fnf ? { fnf: parsed.fnf } : {}),
        },
        analysis.waveform.durationMs,
      );
      const bytes = new TextEncoder().encode(JSON.stringify(chart)),
        chartHash = await sha256(bytes);
      await writeChart(finalChart, bytes, chartHash, op.id);
      const format = parsed.format === "osu-mania" ? "osu" : parsed.format;
      const sourceFormat = z.enum(["native", "osu", "fnf-legacy", "fnf-vslice"]).parse(format);
      candidate = {
        audio_path: finalAudio,
        chart_path: finalChart,
        audio_hash: analysis.audioHash,
        chart_hash: chartHash,
        duration_ms: analysis.waveform.durationMs,
        bpm: chart.bpm,
        offset: chart.offset,
        note_count: chart.notes.length,
        fnf_side: chart.fnf?.playerSide ?? null,
        mime: analysis.mime,
        preview_allowed: false,
        source_format: sourceFormat,
        timing_basis: sourceFormat === "native" ? "beats" : "absolute-seconds",
        ...(replacement
          ? { replacement }
          : {
              legacy: {
                audio_path: audioPath,
                chart_path: chartPath,
                chart_source_hash: await sha256(sourceBytes),
              },
            }),
      };
    }
    const ready = await db()
      .from("song_edit_operations")
      .update({
        state: "prepared",
        candidate: toJson(candidate),
        updated_at: new Date().toISOString(),
        lease_expires_at: null,
      })
      .eq("id", op.id)
      .eq("owner_id", actor)
      .eq("worker_id", worker)
      .eq("state", "preparing")
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .single();
    if (ready.error || !ready.data) throw new SongSettingsError("SOURCE_CHANGED");
    return projection(op.id, candidate);
  } catch (error) {
    await db()
      .from("song_edit_operations")
      .update({
        state: "failed",
        error_code: error instanceof SongSettingsError ? error.code : "SOURCE_PREPARATION_FAILED",
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", op.id)
      .eq("worker_id", worker)
      .eq("state", "preparing");
    throw error;
  }
}
export async function prepareFinalRevision(
  actor: string,
  input: SaveSongSettingsInput,
  payloadHash: string,
) {
  const sourceId =
    input.gameplay.action === "keep" ? input.sourceOperationId : input.gameplay.sourceOperationId;
  if (!sourceId) return;
  const result = await db().rpc("get_owner_song_operation", { p_actor: actor, p_id: sourceId });
  if (result.error || !result.data) throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  const op = operationSchema.parse(result.data),
    source = candidateSchema.parse(op.candidate);
  if (
    op.song_id !== input.songId ||
    op.owner_id !== actor ||
    op.state !== "prepared" ||
    Date.parse(op.expires_at) <= Date.now() ||
    op.expected_version !== input.expectedVersion ||
    op.expected_revision_id !== input.expectedRevisionId
  )
    throw new SongSettingsError("SOURCE_CHANGED");
  if (
    op.kind === "replacement" &&
    (!input.previewConsent || input.previewConsent.sourceOperationId !== sourceId)
  )
    throw new SongSettingsError("INVALID_INPUT");
  const prior = await db()
    .from("song_revision_candidates")
    .select("*")
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (prior.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  if (source.legacy) {
    const [audioHash, chartBytes] = await Promise.all([
      hashAudio("songs", source.legacy.audio_path),
      readBoundedStorage("songs", source.legacy.chart_path, MAX_CHART_BYTES),
    ]);
    if (
      audioHash !== source.audio_hash ||
      (await sha256(chartBytes)) !== source.legacy.chart_source_hash
    )
      throw new SongSettingsError("SOURCE_CHANGED");
  }
  if (prior.data) {
    if (prior.data.source_operation_id !== sourceId || prior.data.payload_hash !== payloadHash)
      throw new SongSettingsError("STALE_VERSION");
    return;
  }
  const originalBytes = await readBoundedStorage(
    "chart-revision-assets",
    source.chart_path,
    MAX_CHART_BYTES,
  );
  if ((await sha256(originalBytes)) !== source.chart_hash)
    throw new SongSettingsError("SOURCE_CHANGED");
  const original = validateCanonicalChart(
    JSON.parse(new TextDecoder().decode(originalBytes)),
    source.duration_ms,
  );
  const chart =
    input.gameplay.action === "timing"
      ? applySongTiming(original, source.timing_basis, input.gameplay, source.duration_ms)
      : original;
  const bytes = new TextEncoder().encode(JSON.stringify(chart)),
    chartHash = await sha256(bytes);
  const chartPath = `${input.songId}/${input.requestId}/chart.json`,
    audioPath = `${input.songId}/${input.requestId}/audio`;
  await writeChart(chartPath, bytes, chartHash, sourceId);
  await manifest(audioPath, sourceId);
  const copy = await supabaseAdmin.storage
    .from("chart-revision-assets")
    .copy(source.audio_path, audioPath);
  // A retry can reuse only exactly the same immutable bytes, never upsert.
  if (
    copy.error &&
    !prior.data &&
    (await hashAudio("chart-revision-assets", audioPath)) !== source.audio_hash
  )
    throw new SongSettingsError("ASSET_NOT_READY");
  if ((await hashAudio("chart-revision-assets", audioPath)) !== source.audio_hash)
    throw new SongSettingsError("SOURCE_CHANGED");
  if (input.metadata.previewStartMs !== null && input.metadata.previewStartMs >= source.duration_ms)
    throw new SongSettingsError("INVALID_INPUT");
  const consent = input.previewConsent?.allowed ?? source.preview_allowed;
  const candidate = {
    ...source,
    request_id: input.requestId,
    validated: true,
    chart_path: chartPath,
    audio_path: audioPath,
    chart_hash: chartHash,
    bpm: chart.bpm,
    offset: chart.offset,
    preview_allowed: consent,
  };
  const inserted = await db()
    .from("song_revision_candidates")
    .insert({
      request_id: input.requestId,
      source_operation_id: sourceId,
      payload_hash: payloadHash,
      candidate: toJson(candidate),
    });
  if (inserted.error) {
    if (inserted.error.code !== "23505") throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
    const raced = await db()
      .from("song_revision_candidates")
      .select("*")
      .eq("request_id", input.requestId)
      .single();
    if (
      raced.error ||
      raced.data.source_operation_id !== sourceId ||
      raced.data.payload_hash !== payloadHash ||
      canonicalJson(raced.data.candidate) !== canonicalJson(toJson(candidate))
    )
      throw new SongSettingsError("STALE_VERSION");
  }
}

// Kept as an explicit server export for artifact-level runtime verification.
export { analyzeAudioStream };
