import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { canonicalJson, sha256 } from "./xpContract";
import { settingsDatabase, settingsJson as toJson } from "./songSettingsDatabase";
import {
  saveSongSettingsSchema,
  songSettingsReceiptSchema,
  songSettingsRowSchema,
  settingsMetadata,
  validateSettingsMetadata,
  type SaveSongSettingsInput,
} from "./songSettingsContract";

export class SongSettingsError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "NOT_FOUND_OR_FORBIDDEN"
      | "STALE_VERSION"
      | "INVALID_INPUT"
      | "SOURCE_CHANGED"
      | "ASSET_NOT_READY"
      | "SERVER_NOT_READY"
      | "RETRYABLE_TRANSPORT",
    readonly retryable = false,
  ) {
    super(code);
  }
}
function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "40001") throw new SongSettingsError("STALE_VERSION");
  if (error.code === "42501") throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  if (error.code === "22023" || error.code === "22P02" || error.code === "22003")
    throw new SongSettingsError("INVALID_INPUT");
  if (["PGRST202", "42703", "42P01", "55000"].includes(error.code ?? ""))
    throw new SongSettingsError("SERVER_NOT_READY");
  throw new SongSettingsError("RETRYABLE_TRANSPORT", true);
}
export async function songSettingsCapabilities() {
  const disabled = {
    songSettingsEnabled: false,
    songBackgroundUploadEnabled: false,
    songTimingRevisionEnabled: false,
  };
  try {
    const { data, error } = await settingsDatabase(supabaseAdmin)
      .from("song_settings_gates")
      .select("*")
      .eq("singleton", true)
      .single();
    if (error || !data || data.schema_version !== 1) return disabled;
    const readiness = await settingsDatabase(supabaseAdmin).rpc("song_settings_schema_ready", {});
    if (readiness.error || readiness.data !== true) return disabled;
    const settings = data.settings_enabled && process.env["PULSE_SONG_SETTINGS_ENABLED"] === "true";
    return {
      songSettingsEnabled: settings,
      songBackgroundUploadEnabled:
        settings &&
        data.background_enabled &&
        process.env["PULSE_SONG_BACKGROUND_ENABLED"] === "true",
      songTimingRevisionEnabled:
        settings &&
        data.timing_enabled &&
        process.env["PULSE_SONG_TIMING_ENABLED"] === "true" &&
        process.env["PULSE_REVISIONS_ENABLED"] === "true",
    };
  } catch {
    return disabled;
  }
}
export async function readSongSettings(
  client: SupabaseClient<Database>,
  actor: string,
  songId: string,
) {
  const { data, error } = await settingsDatabase(client).rpc("get_song_settings", {
    p_song_id: songId,
  });
  if (error) databaseError(error);
  const row = songSettingsRowSchema.parse(data);
  if (row.user_id !== actor) throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
  return row;
}
export async function saveSettings(
  client: SupabaseClient<Database>,
  actor: string,
  raw: SaveSongSettingsInput,
) {
  const input = saveSongSettingsSchema.parse(raw);
  const db = settingsDatabase(supabaseAdmin);
  const fingerprint = await sha256(new TextEncoder().encode(canonicalJson(input)));
  // Receipt lookup precedes current-version checks and write gates, including after a rollout rollback.
  const { data: previous, error: receiptError } = await db
    .from("song_edit_operations")
    .select("*")
    .eq("id", input.requestId)
    .maybeSingle();
  if (receiptError) databaseError(receiptError);
  if (previous) {
    if (previous.owner_id !== actor || previous.song_id !== input.songId)
      throw new SongSettingsError("NOT_FOUND_OR_FORBIDDEN");
    if (previous.kind !== "save" || previous.payload_hash !== fingerprint)
      throw new SongSettingsError("STALE_VERSION");
    if (previous.state === "committed") return songSettingsReceiptSchema.parse(previous.receipt);
  }
  const capabilities = await songSettingsCapabilities();
  if (!capabilities.songSettingsEnabled) throw new SongSettingsError("SERVER_NOT_READY");
  const row = await readSongSettings(client, actor, input.songId);
  if (
    row.metadata_version !== input.expectedVersion ||
    row.current_revision_id !== input.expectedRevisionId
  )
    throw new SongSettingsError("STALE_VERSION");
  // Preparing a source is a separate operation. A missing prepared source never falls back to mutable legacy paths.
  const hasSource = input.gameplay.action !== "keep" || input.sourceOperationId !== undefined;
  if (hasSource && !capabilities.songTimingRevisionEnabled)
    throw new SongSettingsError("SERVER_NOT_READY");
  if (input.background.action !== "keep" && !capabilities.songBackgroundUploadEnabled)
    throw new SongSettingsError("SERVER_NOT_READY");
  let durationMs: number | null = null;
  if (row.current_revision_id) {
    const { data, error } = await supabaseAdmin
      .from("chart_revisions")
      .select("duration_ms")
      .eq("id", row.current_revision_id)
      .eq("song_id", row.id)
      .single();
    if (error || !data) throw new SongSettingsError("ASSET_NOT_READY");
    durationMs = data.duration_ms;
  }
  if (
    !hasSource &&
    Object.keys(validateSettingsMetadata(input.metadata, settingsMetadata(row), durationMs)).length
  )
    throw new SongSettingsError("INVALID_INPUT");
  const intent = await db.rpc("begin_song_settings_save", {
    p_actor: actor,
    p_payload: toJson(input),
    p_hash: fingerprint,
  });
  if (intent.error) databaseError(intent.error);
  try {
    if (hasSource) {
      const { prepareFinalRevision } = await import("./songSource.server");
      await prepareFinalRevision(actor, input, fingerprint);
    }
    const { data, error } = await db.rpc("commit_song_settings", {
      p_actor: actor,
      p_payload: toJson(input),
      p_payload_hash: fingerprint,
    });
    if (error) databaseError(error);
    return songSettingsReceiptSchema.parse(data);
  } catch (error) {
    if (
      error instanceof SongSettingsError &&
      !error.retryable &&
      error.code !== "SERVER_NOT_READY"
    ) {
      await db
        .from("song_edit_operations")
        .update({ state: "failed", error_code: error.code, updated_at: new Date().toISOString() })
        .eq("id", input.requestId)
        .eq("owner_id", actor)
        .eq("payload_hash", fingerprint)
        .eq("state", "preparing");
    }
    throw error;
  }
}
export async function readSettingsOperation(actor: string, operationId: string) {
  const { data, error } = await settingsDatabase(supabaseAdmin)
    .from("song_edit_operations")
    .select("*")
    .eq("id", operationId)
    .eq("owner_id", actor)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) return null;
  return {
    id: data.id,
    songId: data.song_id,
    state: data.state,
    errorCode: data.error_code,
    receipt: data.receipt ? songSettingsReceiptSchema.parse(data.receipt) : null,
  };
}
