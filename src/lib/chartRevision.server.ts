import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertManagedPath, MAX_CHART_BYTES } from "./chartValidation";
import { MAX_AUDIO_BYTES } from "./waveform";
import { canonicalJson, sha256 } from "./xpContract";
import { settingsDatabase } from "./songSettingsDatabase";
import { saveSongSettingsSchema, settingsMetadata } from "./songSettingsContract";
import { readSongSettings, saveSettings, SongSettingsError } from "./songSettings.server";
import { prepareSongSource } from "./songSource.server";

/** Compatibility adapter. It never inserts or publishes a revision itself. */
export async function createRevision(
  client: SupabaseClient<Database>,
  actor: string,
  input: {
    songId: string;
    requestId: string;
    expectedRevision: string | null;
    expectedVersion: number;
    audioPath: string;
    chartPath: string;
    chartType: "mania" | "fnf";
    side: "left" | "right";
    rightsConfirmed: true;
    previewAllowed: boolean;
    previewStartMs: number;
  },
) {
  const row = await readSongSettings(client, actor, input.songId);
  const prefix = `${actor}/${row.id}/revisions/${input.requestId}/`;
  if (input.audioPath !== `${prefix}audio` || input.chartPath !== `${prefix}chart`)
    throw new SongSettingsError("INVALID_INPUT");
  assertManagedPath(input.audioPath, actor);
  assertManagedPath(input.chartPath, actor);
  // A deterministic, separate source operation binds every legacy request field.
  const digest = await sha256(new TextEncoder().encode(canonicalJson(input)));
  const sourceId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const prior = await settingsDatabase(supabaseAdmin).rpc("get_owner_song_operation", {
    p_actor: actor,
    p_id: input.requestId,
  });
  if (prior.error) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  const stored =
    prior.data && typeof prior.data === "object" && !Array.isArray(prior.data)
      ? prior.data["candidate"]
      : null;
  const original =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? saveSongSettingsSchema.safeParse(stored["payload"])
      : null;
  const payload = saveSongSettingsSchema.parse({
    songId: input.songId,
    requestId: input.requestId,
    expectedVersion: String(input.expectedVersion),
    expectedRevisionId: input.expectedRevision,
    metadata: {
      ...(original?.success ? original.data.metadata : settingsMetadata(row)),
      previewStartMs: input.previewStartMs,
    },
    background: { action: "keep" },
    gameplay: { action: "prepared-replacement", sourceOperationId: sourceId },
    rightsConfirmation: { confirmed: true, sourceOperationId: sourceId },
    previewConsent: { allowed: input.previewAllowed, sourceOperationId: sourceId },
  });
  if (!original?.success) {
    const size = async (path: string, max: number) => {
      const result = await supabaseAdmin.storage.from("songs").info(path);
      const bytes = result.data?.size;
      if (result.error || !bytes || !Number.isSafeInteger(bytes) || bytes > max)
        throw new SongSettingsError("INVALID_INPUT");
      return bytes;
    };
    const [audioBytes, chartBytes] = await Promise.all([
      size(input.audioPath, MAX_AUDIO_BYTES),
      size(input.chartPath, MAX_CHART_BYTES),
    ]);
    await prepareSongSource(
      client,
      actor,
      {
        songId: row.id,
        operationId: sourceId,
        expectedVersion: String(input.expectedVersion),
        expectedRevisionId: input.expectedRevision,
      },
      {
        bucket: "songs",
        audioPath: input.audioPath,
        chartPath: input.chartPath,
        chartType: input.chartType,
        side: input.side,
        audioBytes,
        chartBytes,
      },
    );
  }
  const receipt = await saveSettings(client, actor, payload);
  // Preserve the old response's legacy fields; all mutable settings come from the text-version receipt.
  const legacy = await supabaseAdmin
    .from("songs")
    .select("*")
    .eq("id", row.id)
    .eq("user_id", actor)
    .single();
  if (legacy.error || !legacy.data) throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
  return {
    ...legacy.data,
    ...receipt.song,
    metadata_version: Number(receipt.version),
    fnf_side: receipt.song.fnf_side ?? legacy.data.fnf_side,
  };
}
