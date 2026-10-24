import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settingsDatabase } from "./songSettingsDatabase";
import { canonicalJson, sha256, toJson } from "./xpContract";
import { reserveReplacementSchema, type PrepareSongSourceInput } from "./songSettingsContract";
import {
  SongSettingsError,
  songSettingsCapabilities,
  readSongSettings,
} from "./songSettings.server";
import { prepareSongSource } from "./songSource.server";
type Reservation = z.infer<typeof reserveReplacementSchema>;
export async function reserveReplacement(
  client: SupabaseClient<Database>,
  actor: string,
  input: Reservation,
) {
  if (!(await songSettingsCapabilities()).songTimingRevisionEnabled)
    throw new SongSettingsError("SERVER_NOT_READY");
  await readSongSettings(client, actor, input.songId);
  const db = settingsDatabase(supabaseAdmin),
    worker = crypto.randomUUID();
  const identity = {
    songId: input.songId,
    operationId: input.operationId,
    expectedVersion: input.expectedVersion,
    expectedRevisionId: input.expectedRevisionId,
  };
  const fingerprint = await sha256(new TextEncoder().encode(canonicalJson(identity)));
  const begin = await db.rpc("begin_song_settings_source", {
    p_actor: actor,
    p_id: input.operationId,
    p_song_id: input.songId,
    p_version: input.expectedVersion,
    p_revision: input.expectedRevisionId,
    p_hash: fingerprint,
    p_worker: worker,
    p_kind: "replacement",
  });
  if (begin.error)
    throw new SongSettingsError(begin.error.code === "40001" ? "STALE_VERSION" : "ASSET_NOT_READY");
  const op = z.object({ state: z.string(), candidate: z.unknown() }).parse(begin.data);
  const replacement = {
    bucket: "chart-revision-assets",
    audioPath: `${input.songId}/${input.operationId}/raw-audio`,
    chartPath: `${input.songId}/${input.operationId}/raw-chart`,
    chartType: input.chartType,
    side: input.side,
    audioBytes: input.audioBytes,
    chartBytes: input.chartBytes,
    audioMime: input.audioMime,
  };
  const prior = op.candidate ? z.object({ replacement: z.unknown() }).parse(op.candidate) : null;
  if (prior && canonicalJson(prior.replacement) !== canonicalJson(replacement))
    throw new SongSettingsError("STALE_VERSION");
  if (op.state === "prepared") return { prepared: true as const, audioUrl: null, chartUrl: null };
  for (const [path, max] of [
    [replacement.audioPath, input.audioBytes],
    [replacement.chartPath, input.chartBytes],
  ] as const) {
    const manifest = await db.from("song_edit_objects").upsert(
      {
        bucket_id: "chart-revision-assets",
        path,
        operation_id: input.operationId,
        max_bytes: max,
      },
      { onConflict: "bucket_id,path", ignoreDuplicates: true },
    );
    if (manifest.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
    const job = await db
      .from("asset_cleanup_jobs")
      .upsert(
        { bucket_id: "chart-revision-assets", path, operation_id: input.operationId },
        { onConflict: "bucket_id,path", ignoreDuplicates: true },
      );
    if (job.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  }
  const updated = await db
    .from("song_edit_operations")
    .update({
      candidate: toJson({ replacement }),
      lease_expires_at: null,
      upload_token_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000 + 60000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.operationId)
    .eq("worker_id", worker)
    .eq("state", "preparing")
    .select("id")
    .single();
  if (updated.error) throw new SongSettingsError("SOURCE_CHANGED");
  const sign = async (path: string) => {
    const result = await supabaseAdmin.storage
      .from("chart-revision-assets")
      .createSignedUploadUrl(path, { upsert: false });
    if (result.error || !result.data) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
    return result.data.signedUrl;
  };
  return {
    prepared: false as const,
    audioUrl: await sign(replacement.audioPath),
    chartUrl: await sign(replacement.chartPath),
  };
}
export async function prepareReplacement(
  client: SupabaseClient<Database>,
  actor: string,
  input: PrepareSongSourceInput,
) {
  const db = settingsDatabase(supabaseAdmin),
    result = await db.rpc("get_owner_song_operation", { p_actor: actor, p_id: input.operationId });
  if (result.error || !result.data) throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  const op = z
    .object({
      kind: z.literal("replacement"),
      candidate: z.object({
        replacement: z.object({
          bucket: z.literal("chart-revision-assets"),
          audioPath: z.string(),
          chartPath: z.string(),
          chartType: z.enum(["mania", "fnf"]),
          side: z.enum(["left", "right"]),
          audioBytes: z.number().int(),
          chartBytes: z.number().int(),
          audioMime: z.string(),
        }),
      }),
    })
    .parse(result.data);
  const paths = op.candidate.replacement;
  if (
    paths.audioPath !== `${input.songId}/${input.operationId}/raw-audio` ||
    paths.chartPath !== `${input.songId}/${input.operationId}/raw-chart`
  )
    throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  return prepareSongSource(client, actor, input, paths);
}
